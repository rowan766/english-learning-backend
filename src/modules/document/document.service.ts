// src/modules/document/document.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AudioProcessingService } from '../audio/audio-processing.service';
import { SpeechService } from '../speech/speech.service';
import { 
  ProcessDocumentDto, 
  DocumentResponseDto, 
  DocumentType, 
  ParagraphDto,
  ProcessDocumentWithAudioDto,
  DocumentAudioMatchDto,
  DocumentAudioMatchResponseDto,
  AudioSegmentDto
} from './dto/process-document.dto';
import { v4 as uuidv4 } from 'uuid';
import * as mammoth from 'mammoth';
import * as pdfParse from 'pdf-parse';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class DocumentService {
  private readonly logger = new Logger(DocumentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly speechService: SpeechService,
    private readonly audioProcessingService: AudioProcessingService,
  ) {}

  /**
   * 处理文档内容并保存到数据库
   */
  async processDocument(processDocumentDto: ProcessDocumentDto): Promise<DocumentResponseDto> {
    const { content, type, title } = processDocumentDto;
    
    this.logger.log(`开始处理文档: ${title}`);

    // 处理文档内容
    const parsedDocument = await this.parseDocumentContent(content, type, title);
    
    // 保存到数据库
    const savedDocument = await this.saveDocumentToDatabase(parsedDocument);
    
    this.logger.log(`文档处理完成，ID: ${savedDocument.id}`);
    return this.formatDocumentResponse(savedDocument);
  }

  /**
   * 处理文档并生成语音
   */
  async processDocumentWithAudio(
    processDocumentDto: ProcessDocumentWithAudioDto
  ): Promise<DocumentResponseDto> {
    // 先处理并保存文档
    const document = await this.processDocument(processDocumentDto);
    
    // 如果需要生成语音
    if (processDocumentDto.generateAudio !== false) {
      this.logger.log(`开始为文档生成语音，段落数: ${document.paragraphs.length}`);
      
      await this.generateAudioForParagraphs(document.id, document.paragraphs, processDocumentDto);
      
      // 重新获取更新后的文档
      return await this.getDocumentById(document.id);
    }
    
    return document;
  }

  /**
   * 文档与音频智能匹配
   */
  async matchDocumentWithAudio(
    documentBuffer: Buffer,
    audioBuffer: Buffer,
    originalDocumentName: string,
    originalAudioName: string,
    matchOptions: DocumentAudioMatchDto
  ): Promise<DocumentAudioMatchResponseDto> {
    this.logger.log(`开始文档音频匹配: ${originalDocumentName} + ${originalAudioName}`);
    
    try {
      // 1. 保存音频文件并获取信息
      const { filePath: audioFilePath, audioUrl, audioInfo } = 
        await this.audioProcessingService.saveAudioFile(audioBuffer, originalAudioName);
      
      // 2. 解析文档内容
      const documentType = this.getDocumentTypeFromFileName(originalDocumentName);
      const documentContent = await this.extractTextFromBuffer(documentBuffer, documentType);
      
      // 3. 处理文档，获取段落
      const parsedDocument = await this.parseDocumentContent(documentContent, documentType, matchOptions.title);
      
      // 4. 根据策略分割音频
      const audioSegments = await this.segmentAudio(
        audioFilePath,
        matchOptions.segmentStrategy || 'silence',
        matchOptions
      );
      
      // 5. 保存文档到数据库
      const savedDocument = await this.saveDocumentToDatabase({
        ...parsedDocument,
        originalAudioUrl: audioUrl,
        originalAudioDuration: audioInfo.duration,
        matchStrategy: matchOptions.segmentStrategy || 'silence',
      });

      // 6. 智能匹配段落和音频片段
      const matchedResults = await this.matchParagraphsWithAudioSegments(
        savedDocument.paragraphs,
        audioSegments,
        audioFilePath,
        savedDocument.id
      );
      
      // 7. 构建响应
      const response: DocumentAudioMatchResponseDto = {
        ...this.formatDocumentResponse(savedDocument),
        originalAudioUrl: audioUrl,
        originalAudioDuration: audioInfo.duration,
        audioSegments: matchedResults.audioSegments,
        matchStrategy: matchOptions.segmentStrategy || 'silence',
        needsManualAdjustment: matchedResults.needsManualAdjustment,
      };
      
      this.logger.log(`文档音频匹配完成: ${response.paragraphs.length}个段落, ${response.audioSegments.length}个音频片段`);
      return response;
      
    } catch (error) {
      this.logger.error(`文档音频匹配失败: ${error.message}`, error.stack);
      throw new Error(`文档音频匹配失败: ${error.message}`);
    }
  }

  /**
   * 根据ID获取文档
   */
  async getDocumentById(id: string): Promise<DocumentResponseDto> {
    const document = await this.prisma.document.findUnique({
      where: { id },
      include: {
        paragraphs: {
          orderBy: { orderNum: 'asc' }
        },
        audioSegments: {
          orderBy: { orderNum: 'asc' }
        }
      }
    });

    if (!document) {
      throw new Error(`文档未找到: ${id}`);
    }

    return this.formatDocumentResponse(document);
  }

  /**
   * 获取文档列表（支持分页）
   */
  async getDocumentList(skip: number = 0, take: number = 10): Promise<DocumentResponseDto[]> {
    const documents = await this.prisma.document.findMany({
      skip,
      take,
      include: {
        paragraphs: {
          orderBy: { orderNum: 'asc' }
        },
        audioSegments: {
          orderBy: { orderNum: 'asc' }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    return documents.map(doc => this.formatDocumentResponse(doc));
  }

  /**
   * 删除文档及其关联数据
   */
  async deleteDocument(id: string): Promise<boolean> {
    try {
      const document = await this.prisma.document.findUnique({
        where: { id },
        include: {
          paragraphs: true,
          audioSegments: true
        }
      });

      if (!document) {
        return false;
      }

      // 删除关联的音频文件
      await this.deleteAssociatedAudioFiles(document);

      // 删除数据库记录（级联删除会自动删除相关的段落和音频片段）
      await this.prisma.document.delete({
        where: { id }
      });

      this.logger.log(`文档删除成功: ${id}`);
      return true;
    } catch (error) {
      this.logger.error(`删除文档失败: ${error.message}`, error.stack);
      throw new Error(`删除文档失败: ${error.message}`);
    }
  }

  /**
   * 从Buffer中提取Word文档文本
   */
  async extractWordText(buffer: Buffer): Promise<string> {
    try {
      const result = await mammoth.extractRawText({ buffer });
      return result.value;
    } catch (error) {
      throw new Error(`Word文档解析失败: ${error.message}`);
    }
  }

  /**
   * 从Buffer中提取PDF文档文本
   */
  async extractPdfText(buffer: Buffer): Promise<string> {
    try {
      const data = await pdfParse(buffer);
      return data.text;
    } catch (error) {
      throw new Error(`PDF文档解析失败: ${error.message}`);
    }
  }

  /**
   * 检查是否为文档文件
   */
  isDocumentFile(file: Express.Multer.File): boolean {
    const documentMimeTypes = [
      'text/plain',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];
    
    if (documentMimeTypes.includes(file.mimetype)) {
      return true;
    }
    
    const extension = file.originalname.toLowerCase().split('.').pop();
    return ['txt', 'pdf', 'doc', 'docx'].includes(extension || '');
  }

  /**
   * 检查是否为音频文件
   */
  isAudioFile(file: Express.Multer.File): boolean {
    const audioMimeTypes = [
      'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/wave',
      'audio/x-wav', 'audio/mp4', 'audio/m4a', 'audio/aac',
      'audio/ogg', 'audio/webm'
    ];
    
    if (audioMimeTypes.includes(file.mimetype)) {
      return true;
    }
    
    const extension = file.originalname.toLowerCase().split('.').pop();
    return ['mp3', 'wav', 'wave', 'm4a', 'aac', 'ogg', 'webm'].includes(extension || '');
  }

  /**
   * 获取不带扩展名的文件名
   */
  getFileNameWithoutExtension(filename: string): string {
    return filename.replace(/\.[^/.]+$/, '');
  }

  // =================== 私有方法 ===================

  /**
   * 删除关联的音频文件
   */
  private async deleteAssociatedAudioFiles(document: any): Promise<void> {
    const audioDir = path.join(process.cwd(), 'public', 'audio');
    
    // 删除段落相关的音频文件
    for (const paragraph of document.paragraphs || []) {
      if (paragraph.audioFileName) {
        const audioFilePath = path.join(audioDir, `${paragraph.audioFileName}.mp3`);
        try {
          if (fs.existsSync(audioFilePath)) {
            fs.unlinkSync(audioFilePath);
            this.logger.log(`删除段落音频文件: ${audioFilePath}`);
          }
        } catch (error) {
          this.logger.warn(`删除段落音频文件失败: ${audioFilePath}, ${error.message}`);
        }
      }
    }

    // 删除音频片段文件
    for (const audioSegment of document.audioSegments || []) {
      if (audioSegment.segmentAudioUrl) {
        const fileName = audioSegment.segmentAudioUrl.replace('/audio/', '');
        const audioFilePath = path.join(audioDir, fileName);
        try {
          if (fs.existsSync(audioFilePath)) {
            fs.unlinkSync(audioFilePath);
            this.logger.log(`删除音频片段文件: ${audioFilePath}`);
          }
        } catch (error) {
          this.logger.warn(`删除音频片段文件失败: ${audioFilePath}, ${error.message}`);
        }
      }
    }

    // 删除原始音频文件
    if (document.originalAudioUrl) {
      const fileName = document.originalAudioUrl.replace('/audio/', '');
      const audioFilePath = path.join(audioDir, fileName);
      try {
        if (fs.existsSync(audioFilePath)) {
          fs.unlinkSync(audioFilePath);
          this.logger.log(`删除原始音频文件: ${audioFilePath}`);
        }
      } catch (error) {
        this.logger.warn(`删除原始音频文件失败: ${audioFilePath}, ${error.message}`);
      }
    }
  }

  /**
   * 解析文档内容
   */
  private async parseDocumentContent(
    content: string, 
    type: DocumentType, 
    title?: string
  ) {
    const cleanContent = this.cleanText(content);
    const paragraphs = this.splitIntoParagraphs(cleanContent);
    const wordCount = this.countWords(cleanContent);
    const sentenceCount = paragraphs.reduce((count, p) => count + p.sentences.length, 0);

    return {
      id: uuidv4(),
      title: title || `Document_${Date.now()}`,
      content: cleanContent,
      type,
      wordCount,
      sentenceCount,
      paragraphCount: paragraphs.length,
      paragraphs,
    };
  }

  /**
   * 保存文档到数据库
   */
  private async saveDocumentToDatabase(documentData: any) {
    return await this.prisma.document.create({
      data: {
        id: documentData.id,
        title: documentData.title,
        content: documentData.content,
        type: documentData.type,
        wordCount: documentData.wordCount,
        sentenceCount: documentData.sentenceCount,
        paragraphCount: documentData.paragraphCount,
        originalAudioUrl: documentData.originalAudioUrl || null,
        originalAudioDuration: documentData.originalAudioDuration || null,
        matchStrategy: documentData.matchStrategy || null,
        paragraphs: {
          create: documentData.paragraphs.map((paragraph: any, index: number) => ({
            id: paragraph.id,
            content: paragraph.content,
            orderNum: index + 1,
            wordCount: paragraph.wordCount,
            sentences: paragraph.sentences,
          }))
        }
      },
      include: {
        paragraphs: {
          orderBy: { orderNum: 'asc' }
        }
      }
    });
  }

  /**
   * 为段落生成音频
   */
  private async generateAudioForParagraphs(
    documentId: string,
    paragraphs: ParagraphDto[],
    options: ProcessDocumentWithAudioDto
  ): Promise<void> {
    for (const paragraph of paragraphs) {
      try {
        const speechResponse = await this.speechService.generateSpeech({
          text: paragraph.content,
          voiceId: options.voiceId as any,
          outputFormat: options.outputFormat as any,
          fileName: `${documentId}_paragraph_${paragraph.order}`,
        });

        // 更新段落的音频信息
        await this.prisma.paragraph.update({
          where: { id: paragraph.id },
          data: {
            audioUrl: speechResponse.audioUrl,
            audioFileName: speechResponse.fileName,
            audioDuration: speechResponse.duration,
          }
        });

        this.logger.log(`段落 ${paragraph.order} 语音生成成功`);
      } catch (error) {
        this.logger.error(`段落 ${paragraph.order} 语音生成失败: ${error.message}`);
      }
    }
  }

  /**
   * 根据策略分割音频
   */
  private async segmentAudio(
    audioFilePath: string,
    strategy: string,
    options: DocumentAudioMatchDto
  ): Promise<any[]> {
    switch (strategy) {
      case 'silence':
        return await this.audioProcessingService.segmentBysilence(
          audioFilePath,
          options.silenceThreshold || 0.01,
          options.minSilenceDuration || 1.0
        );
      
      case 'time':
        return await this.audioProcessingService.segmentByTime(
          audioFilePath,
          options.segmentDuration || 30
        );
      
      case 'manual':
        const audioInfo = await this.audioProcessingService.getAudioInfo(audioFilePath);
        return [{
          startTime: 0,
          endTime: audioInfo.duration,
          duration: audioInfo.duration,
        }];
      
      default:
        throw new Error(`不支持的分段策略: ${strategy}`);
    }
  }

  /**
   * 智能匹配段落和音频片段
   */
  private async matchParagraphsWithAudioSegments(
    paragraphs: any[],
    audioSegments: any[],
    audioFilePath: string,
    documentId: string
  ): Promise<{
    paragraphs: ParagraphDto[];
    audioSegments: AudioSegmentDto[];
    needsManualAdjustment: boolean;
  }> {
    const processedAudioSegments: AudioSegmentDto[] = [];
    
    const paragraphCount = paragraphs.length;
    const segmentCount = audioSegments.length;
    const ratio = Math.abs(paragraphCount - segmentCount) / Math.max(paragraphCount, segmentCount);
    
    let needsManualAdjustment = ratio > 0.3;
    
    if (ratio <= 0.2) {
      await this.oneToOneMatch(paragraphs, audioSegments, audioFilePath, documentId, processedAudioSegments);
    } else if (segmentCount > paragraphCount) {
      await this.mergeAudioSegments(paragraphs, audioSegments, audioFilePath, documentId, processedAudioSegments);
    } else {
      await this.splitAudioSegments(paragraphs, audioSegments, audioFilePath, documentId, processedAudioSegments);
    }
    
    return {
      paragraphs: paragraphs.map(p => ({
        id: p.id,
        content: p.content,
        order: p.orderNum,
        wordCount: p.wordCount,
        sentences: p.sentences,
        audioUrl: p.audioUrl,
        audioFileName: p.audioFileName,
        audioDuration: p.audioDuration,
      })),
      audioSegments: processedAudioSegments,
      needsManualAdjustment,
    };
  }

  /**
   * 一对一匹配
   */
  private async oneToOneMatch(
    paragraphs: any[],
    audioSegments: any[],
    audioFilePath: string,
    documentId: string,
    processedAudioSegments: AudioSegmentDto[]
  ): Promise<void> {
    const minLength = Math.min(paragraphs.length, audioSegments.length);
    
    const segmentResults = await this.audioProcessingService.generateSegmentAudios(
      audioFilePath,
      audioSegments.slice(0, minLength),
      documentId
    );
    
    for (let i = 0; i < minLength; i++) {
      const paragraph = paragraphs[i];
      const segmentResult = segmentResults[i];
      
      if (segmentResult) {
        await this.prisma.paragraph.update({
          where: { id: paragraph.id },
          data: {
            audioUrl: segmentResult.audioUrl,
            audioFileName: segmentResult.segmentId,
            audioDuration: segmentResult.segment.duration,
          }
        });
        
        processedAudioSegments.push({
          id: segmentResult.segmentId,
          startTime: segmentResult.segment.startTime,
          endTime: segmentResult.segment.endTime,
          segmentAudioUrl: segmentResult.audioUrl,
          duration: segmentResult.segment.duration,
          order: i + 1,
        });
      } else {
        this.logger.warn(`第${i + 1}个段落的音频生成失败，跳过`);
      }
    }
  }

  /**
   * 合并音频片段策略
   */
  private async mergeAudioSegments(
    paragraphs: any[],
    audioSegments: any[],
    audioFilePath: string,
    documentId: string,
    processedAudioSegments: AudioSegmentDto[]
  ): Promise<void> {
    const segmentsPerParagraph = Math.ceil(audioSegments.length / paragraphs.length);
    
    for (let i = 0; i < paragraphs.length; i++) {
      const startIndex = i * segmentsPerParagraph;
      const endIndex = Math.min(startIndex + segmentsPerParagraph, audioSegments.length);
      const segmentsToMerge = audioSegments.slice(startIndex, endIndex);
      
      if (segmentsToMerge.length > 0) {
        const mergedSegment = {
          startTime: segmentsToMerge[0].startTime,
          endTime: segmentsToMerge[segmentsToMerge.length - 1].endTime,
          duration: segmentsToMerge[segmentsToMerge.length - 1].endTime - segmentsToMerge[0].startTime,
        };
        
        const segmentId = uuidv4();
        const outputFileName = `${documentId}_merged_segment_${i + 1}_${segmentId}.mp3`;
        
        try {
          const audioUrl = await this.audioProcessingService.extractAudioSegment(
            audioFilePath,
            mergedSegment.startTime,
            mergedSegment.duration,
            outputFileName
          );
          
          await this.prisma.paragraph.update({
            where: { id: paragraphs[i].id },
            data: {
              audioUrl: audioUrl,
              audioFileName: segmentId,
              audioDuration: mergedSegment.duration,
            }
          });
          
          processedAudioSegments.push({
            id: segmentId,
            startTime: mergedSegment.startTime,
            endTime: mergedSegment.endTime,
            segmentAudioUrl: audioUrl,
            duration: mergedSegment.duration,
            order: i + 1,
          });
        } catch (error) {
          this.logger.error(`合并音频片段失败: ${error.message}`);
        }
      }
    }
  }

  /**
   * 分割音频片段策略
   */
  private async splitAudioSegments(
    paragraphs: any[],
    audioSegments: any[],
    audioFilePath: string,
    documentId: string,
    processedAudioSegments: AudioSegmentDto[]
  ): Promise<void> {
    const paragraphsPerSegment = Math.ceil(paragraphs.length / audioSegments.length);
    
    for (let i = 0; i < audioSegments.length; i++) {
      const segment = audioSegments[i];
      const startParagraphIndex = i * paragraphsPerSegment;
      const endParagraphIndex = Math.min(startParagraphIndex + paragraphsPerSegment, paragraphs.length);
      const paragraphsForThisSegment = paragraphs.slice(startParagraphIndex, endParagraphIndex);
      
      const subSegmentDuration = segment.duration / paragraphsForThisSegment.length;
      
      for (let j = 0; j < paragraphsForThisSegment.length; j++) {
        const paragraph = paragraphsForThisSegment[j];
        const subSegmentStart = segment.startTime + (j * subSegmentDuration);
        const subSegmentEnd = Math.min(subSegmentStart + subSegmentDuration, segment.endTime);
        const subSegmentDur = subSegmentEnd - subSegmentStart;
        
        const segmentId = uuidv4();
        const outputFileName = `${documentId}_split_segment_${startParagraphIndex + j + 1}_${segmentId}.mp3`;
        
        try {
          const audioUrl = await this.audioProcessingService.extractAudioSegment(
            audioFilePath,
            subSegmentStart,
            subSegmentDur,
            outputFileName
          );
          
          await this.prisma.paragraph.update({
            where: { id: paragraph.id },
            data: {
              audioUrl: audioUrl,
              audioFileName: segmentId,
              audioDuration: subSegmentDur,
            }
          });
          
          processedAudioSegments.push({
            id: segmentId,
            startTime: subSegmentStart,
            endTime: subSegmentEnd,
            segmentAudioUrl: audioUrl,
            duration: subSegmentDur,
            order: startParagraphIndex + j + 1,
          });
        } catch (error) {
          this.logger.error(`分割音频片段失败: ${error.message}`);
        }
      }
    }
  }

  /**
   * 格式化文档响应
   */
  private formatDocumentResponse(document: any): DocumentResponseDto {
    return {
      id: document.id,
      title: document.title,
      content: document.content,
      type: document.type,
      wordCount: document.wordCount,
      sentenceCount: document.sentenceCount,
      paragraphCount: document.paragraphCount,
      paragraphs: document.paragraphs.map((p: any) => ({
        id: p.id,
        content: p.content,
        order: p.orderNum,
        wordCount: p.wordCount,
        sentences: p.sentences,
        audioUrl: p.audioUrl,
        audioFileName: p.audioFileName,
        audioDuration: p.audioDuration,
      })),
      createdAt: document.createdAt,
    };
  }

  /**
   * 清理文本内容
   */
  private cleanText(text: string): string {
    return text
      .replace(/\r\n/g, '\n')    
      .replace(/\n{3,}/g, '\n\n') 
      .replace(/[ \t]+/g, ' ')   
      .trim();                   
  }

  /**
   * 将文本分割成段落
   */
  private splitIntoParagraphs(text: string): ParagraphDto[] {
    const paragraphTexts = text
      .split(/\n\s*\n/)
      .map(p => p.trim())
      .filter(p => p.length > 0);

    return paragraphTexts.map((paragraphText, index) => {
      const sentences = this.splitIntoSentences(paragraphText);
      const wordCount = this.countWords(paragraphText);

      return {
        id: uuidv4(),
        content: paragraphText,
        order: index + 1,
        wordCount,
        sentences,
      };
    });
  }

  /**
   * 将文本分割成句子
   */
  private splitIntoSentences(text: string): string[] {
    return text
      .split(/(?<=[.!?])\s+(?=[A-Z])/)  
      .map(sentence => sentence.trim())
      .filter(sentence => sentence.length > 0);
  }

  /**
   * 统计单词数
   */
  private countWords(text: string): number {
    return text
      .split(/\s+/)
      .filter(word => word.length > 0 && /[a-zA-Z]/.test(word))
      .length;
  }

  /**
   * 根据文件名获取文档类型
   */
  private getDocumentTypeFromFileName(fileName: string): DocumentType {
    const extension = fileName.toLowerCase().split('.').pop();
    switch (extension) {
      case 'txt':
        return DocumentType.TEXT;
      case 'pdf':
        return DocumentType.PDF;
      case 'doc':
      case 'docx':
        return DocumentType.WORD;
      default:
        return DocumentType.TEXT;
    }
  }

  /**
   * 从Buffer中提取文本内容
   */
  private async extractTextFromBuffer(buffer: Buffer, type: DocumentType): Promise<string> {
    switch (type) {
      case DocumentType.TEXT:
        return buffer.toString('utf-8');
      case DocumentType.PDF:
        return await this.extractPdfText(buffer);
      case DocumentType.WORD:
        return await this.extractWordText(buffer);
      default:
        throw new Error(`不支持的文档类型: ${type}`);
    }
  }
}