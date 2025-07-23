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
   * 根据ID获取文档
   */
  async getDocumentById(id: string): Promise<DocumentResponseDto> {
    const document = await this.prisma.englishDocument.findUnique({
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
    const documents = await this.prisma.englishDocument.findMany({
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
      const document = await this.prisma.englishDocument.findUnique({
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
      await this.prisma.englishDocument.delete({
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
   * 文档与音频智能匹配
   */
  async matchDocumentWithAudio(
    documentBuffer: Buffer,
    audioBuffer: Buffer,
    originalDocumentName: string,
    originalAudioName: string,
    matchOptions: any
  ): Promise<any> {
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
      
      // 4. 根据段落数量智能分割音频
      const audioSegments = await this.audioProcessingService.segmentByTextParagraphs(
        audioFilePath,
        parsedDocument.paragraphs.length,
        audioInfo.duration
      );
      
      // 5. 保存文档到数据库
      const savedDocument = await this.saveDocumentToDatabase({
        ...parsedDocument,
        originalAudioUrl: audioUrl,
        originalAudioDuration: audioInfo.duration,
        matchStrategy: matchOptions.segmentStrategy || 'smart',
      });

      // 6. 为每个段落生成对应的音频片段
      const matchedResults = await this.matchParagraphsWithAudioSegments(
        savedDocument.paragraphs,
        audioSegments,
        audioFilePath,
        savedDocument.id
      );
      
      // 7. 构建响应
      const response = {
        ...this.formatDocumentResponse(savedDocument),
        originalAudioUrl: audioUrl,
        originalAudioDuration: audioInfo.duration,
        audioSegments: matchedResults.audioSegments,
        matchStrategy: matchOptions.segmentStrategy || 'smart',
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
   * 智能匹配段落和音频片段
   */
  private async matchParagraphsWithAudioSegments(
    paragraphs: any[],
    audioSegments: any[],
    audioFilePath: string,
    documentId: string
  ): Promise<{
    audioSegments: any[];
    needsManualAdjustment: boolean;
  }> {
    const processedAudioSegments: any[] = [];
    
    // 生成音频片段文件
    const segmentResults = await this.audioProcessingService.generateSegmentAudios(
      audioFilePath,
      audioSegments,
      documentId
    );
    
    // 为每个段落关联音频片段
    for (let i = 0; i < Math.min(paragraphs.length, segmentResults.length); i++) {
      const paragraph = paragraphs[i];
      const segmentResult = segmentResults[i];
      
      if (segmentResult) {
        // 更新段落的音频信息
        await this.prisma.englishParagraph.update({
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
          paragraphId: paragraph.id,
        });
      }
    }
    
    // 判断是否需要手动调整
    const ratio = Math.abs(paragraphs.length - audioSegments.length) / Math.max(paragraphs.length, audioSegments.length);
    const needsManualAdjustment = ratio > 0.2;
    
    return {
      audioSegments: processedAudioSegments,
      needsManualAdjustment,
    };
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
    return await this.prisma.englishDocument.create({
      data: {
        id: documentData.id,
        title: documentData.title,
        content: documentData.content,
        type: documentData.type.toUpperCase(),
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
        await this.prisma.englishParagraph.update({
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
}