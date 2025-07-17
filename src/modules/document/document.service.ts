// src/modules/document/document.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { CacheService } from '../cache/cache.service';
import { SpeechService } from '../speech/speech.service';
import { 
  ProcessDocumentDto, 
  DocumentResponseDto, 
  DocumentType, 
  ParagraphDto,
  ProcessDocumentWithAudioDto
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