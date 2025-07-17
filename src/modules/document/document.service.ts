// src/modules/document/document.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { CacheService } from '../cache/cache.service';
import { SpeechService } from '../speech/speech.service';
import { AudioProcessingService } from '../audio/audio-processing.service';
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

@Injectable()
export class DocumentService {
  private readonly logger = new Logger(DocumentService.name);

  constructor(
    private readonly cacheService: CacheService,
    private readonly speechService: SpeechService,
    private readonly audioProcessingService: AudioProcessingService,
  ) {}

  /**
   * 处理文档内容
   */
  async processDocument(processDocumentDto: ProcessDocumentDto): Promise<DocumentResponseDto> {
    const { content, type, title } = processDocumentDto;
    
    // 生成缓存键
    const cacheKey = this.generateCacheKey(content, type);
    
    // 检查缓存
    const cached = this.cacheService.get<DocumentResponseDto>(cacheKey);
    if (cached) {
      this.logger.log(`从缓存获取文档: ${cacheKey}`);
      return cached;
    }

    // 处理文档
    const processedDocument = await this.parseDocument(content, type, title);
    
    // 存入缓存
    this.cacheService.set(cacheKey, processedDocument);
    
    return processedDocument;
  }

  /**
   * 处理文档并生成语音
   */
  async processDocumentWithAudio(
    processDocumentDto: ProcessDocumentWithAudioDto
  ): Promise<DocumentResponseDto> {
    // 先处理文档
    const document = await this.processDocument(processDocumentDto);
    
    // 如果需要生成语音
    if (processDocumentDto.generateAudio !== false) {
      this.logger.log(`开始为文档生成语音，段落数: ${document.paragraphs.length}`);
      
      // 为每个段落生成语音
      for (const paragraph of document.paragraphs) {
        try {
          const speechResponse = await this.speechService.generateSpeech({
            text: paragraph.content,
            voiceId: processDocumentDto.voiceId as any,
            outputFormat: processDocumentDto.outputFormat as any,
            fileName: `${document.id}_paragraph_${paragraph.order}`,
          });

          // 更新段落的语音信息
          paragraph.audioUrl = speechResponse.audioUrl;
          paragraph.audioFileName = speechResponse.fileName;
          paragraph.audioDuration = speechResponse.duration;

          this.logger.log(`段落 ${paragraph.order} 语音生成成功`);
        } catch (error) {
          this.logger.error(`段落 ${paragraph.order} 语音生成失败: ${error.message}`);
          // 继续处理其他段落，不中断整个流程
        }
      }
      
      // 更新缓存
      const cacheKey = this.generateCacheKey(processDocumentDto.content, processDocumentDto.type);
      this.cacheService.set(cacheKey, document);
    }
    
    return document;
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
   * 解析文档内容
   */
  private async parseDocument(
    content: string, 
    type: DocumentType, 
    title?: string
  ): Promise<DocumentResponseDto> {
    // 清理和规范化文本
    const cleanContent = this.cleanText(content);
    
    // 分段处理
    const paragraphs = this.splitIntoParagraphs(cleanContent);
    
    // 统计信息
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
      createdAt: new Date(),
    };
  }

  /**
   * 清理文本内容
   */
  private cleanText(text: string): string {
    return text
      .replace(/\r\n/g, '\n')    // 统一换行符
      .replace(/\n{3,}/g, '\n\n') // 合并多个连续换行为双换行
      .replace(/[ \t]+/g, ' ')   // 合并多个空格和制表符
      .trim();                   // 去除首尾空格
  }

  /**
   * 将文本分割成段落
   */
  private splitIntoParagraphs(text: string): ParagraphDto[] {
    // 按双换行分割段落
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
    // 改进的句子分割，处理缩写等情况
    return text
      .split(/(?<=[.!?])\s+(?=[A-Z])/)  // 在句号、感叹号、问号后面且后跟大写字母的地方分割
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
   * 生成缓存键
   */
  private generateCacheKey(content: string, type: DocumentType): string {
    const hash = this.simpleHash(content);
    return `doc_${type}_${hash}`;
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
      const document = await this.parseDocument(documentContent, documentType, matchOptions.title);
      
      // 4. 根据策略分割音频
      const audioSegments = await this.segmentAudio(
        audioFilePath,
        matchOptions.segmentStrategy || 'silence',
        matchOptions
      );
      
      // 5. 智能匹配段落和音频片段
      const matchedResults = await this.matchParagraphsWithAudioSegments(
        document.paragraphs,
        audioSegments,
        audioFilePath,
        document.id
      );
      
      // 6. 构建响应
      const response: DocumentAudioMatchResponseDto = {
        ...document,
        originalAudioUrl: audioUrl,
        originalAudioDuration: audioInfo.duration,
        audioSegments: matchedResults.audioSegments,
        matchStrategy: matchOptions.segmentStrategy || 'silence',
        needsManualAdjustment: matchedResults.needsManualAdjustment,
      };
      
      // 7. 更新段落信息
      response.paragraphs = matchedResults.paragraphs;
      
      // 8. 缓存结果
      const cacheKey = this.generateCacheKey(`${documentContent}_${originalAudioName}`, documentType);
      this.cacheService.set(cacheKey, response);
      
      this.logger.log(`文档音频匹配完成: ${response.paragraphs.length}个段落, ${response.audioSegments.length}个音频片段`);
      return response;
      
    } catch (error) {
      this.logger.error(`文档音频匹配失败: ${error.message}`, error.stack);
      throw new Error(`文档音频匹配失败: ${error.message}`);
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
        // 手动分段模式，返回整个音频作为一个段落
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
    paragraphs: ParagraphDto[],
    audioSegments: any[],
    audioFilePath: string,
    documentId: string
  ): Promise<{
    paragraphs: ParagraphDto[];
    audioSegments: AudioSegmentDto[];
    needsManualAdjustment: boolean;
  }> {
    const matchedParagraphs = [...paragraphs];
    const processedAudioSegments: AudioSegmentDto[] = [];
    
    // 智能匹配策略：
    // 1. 如果段落数量和音频片段数量相近（差距在20%以内），直接一对一匹配
    // 2. 如果音频片段多于段落，合并相邻片段
    // 3. 如果段落多于音频片段，分割音频片段
    
    const paragraphCount = paragraphs.length;
    const segmentCount = audioSegments.length;
    const ratio = Math.abs(paragraphCount - segmentCount) / Math.max(paragraphCount, segmentCount);
    
    let needsManualAdjustment = ratio > 0.3; // 如果差距超过30%，建议手动调整
    
    if (ratio <= 0.2) {
      // 一对一匹配（差距在20%以内）
      await this.oneToOneMatch(matchedParagraphs, audioSegments, audioFilePath, documentId, processedAudioSegments);
    } else if (segmentCount > paragraphCount) {
      // 音频片段多，合并策略
      await this.mergeAudioSegments(matchedParagraphs, audioSegments, audioFilePath, documentId, processedAudioSegments);
    } else {
      // 段落多，分割策略
      await this.splitAudioSegments(matchedParagraphs, audioSegments, audioFilePath, documentId, processedAudioSegments);
    }
    
    return {
      paragraphs: matchedParagraphs,
      audioSegments: processedAudioSegments,
      needsManualAdjustment,
    };
  }

  /**
   * 一对一匹配
   */
  private async oneToOneMatch(
    paragraphs: ParagraphDto[],
    audioSegments: any[],
    audioFilePath: string,
    documentId: string,
    processedAudioSegments: AudioSegmentDto[]
  ): Promise<void> {
    const minLength = Math.min(paragraphs.length, audioSegments.length);
    
    // 生成音频片段文件
    const segmentResults = await this.audioProcessingService.generateSegmentAudios(
      audioFilePath,
      audioSegments.slice(0, minLength),
      documentId
    );
    
    for (let i = 0; i < minLength; i++) {
      const paragraph = paragraphs[i];
      const segmentResult = segmentResults[i];
      
      if (segmentResult) {
        // 更新段落信息
        paragraph.audioUrl = segmentResult.audioUrl;
        paragraph.audioFileName = segmentResult.segmentId;
        paragraph.audioDuration = segmentResult.segment.duration;
        
        // 添加到音频片段列表
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
    paragraphs: ParagraphDto[],
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
        // 合并片段
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
          
          // 更新段落信息
          paragraphs[i].audioUrl = audioUrl;
          paragraphs[i].audioFileName = segmentId;
          paragraphs[i].audioDuration = mergedSegment.duration;
          
          // 添加到音频片段列表
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
    paragraphs: ParagraphDto[],
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
      
      // 均匀分割这个音频片段
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
          
          // 更新段落信息
          paragraph.audioUrl = audioUrl;
          paragraph.audioFileName = segmentId;
          paragraph.audioDuration = subSegmentDur;
          
          // 添加到音频片段列表
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

  /**
   * 简单哈希函数
   */
  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
  }
}