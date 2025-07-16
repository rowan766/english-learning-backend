// src/modules/document/document.service.ts
import { Injectable } from '@nestjs/common';
import { CacheService } from '../cache/cache.service';
import { ProcessDocumentDto, DocumentResponseDto, DocumentType } from './dto/process-document.dto';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class DocumentService {
  constructor(private readonly cacheService: CacheService) {}

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
      return cached;
    }

    // 处理文档
    const processedDocument = await this.parseDocument(content, type, title);
    
    // 存入缓存
    this.cacheService.set(cacheKey, processedDocument);
    
    return processedDocument;
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
    
    // 分句
    const sentences = this.splitIntoSentences(cleanContent);
    
    // 统计单词数
    const wordCount = this.countWords(cleanContent);
    
    return {
      id: uuidv4(),
      title: title || `Document_${Date.now()}`,
      content: cleanContent,
      type,
      wordCount,
      sentences,
      createdAt: new Date(),
    };
  }

  /**
   * 清理文本内容
   */
  private cleanText(text: string): string {
    return text
      .replace(/\r\n/g, '\n')  // 统一换行符
      .replace(/\s+/g, ' ')    // 合并多个空格
      .trim();                 // 去除首尾空格
  }

  /**
   * 将文本分割成句子
   */
  private splitIntoSentences(text: string): string[] {
    // 基础的句子分割，可以后续优化
    return text
      .split(/[.!?]+/)
      .map(sentence => sentence.trim())
      .filter(sentence => sentence.length > 0);
  }

  /**
   * 统计单词数
   */
  private countWords(text: string): number {
    return text.split(/\s+/).filter(word => word.length > 0).length;
  }

  /**
   * 生成缓存键
   */
  private generateCacheKey(content: string, type: DocumentType): string {
    // 使用内容的简单哈希作为缓存键
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
      hash = hash & hash; // 转换为32位整数
    }
    return Math.abs(hash).toString(36);
  }
}