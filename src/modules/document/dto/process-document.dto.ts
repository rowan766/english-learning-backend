// src/modules/document/dto/process-document.dto.ts
import { IsString, IsOptional, IsEnum } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum DocumentType {
  TEXT = 'text',
  PDF = 'pdf',
  WORD = 'word',
}

export class ProcessDocumentDto {
  @ApiProperty({ 
    description: '文档内容', 
    example: 'Hello world. This is a test sentence.' 
  })
  @IsString()
  content: string;

  @ApiProperty({ 
    description: '文档类型', 
    enum: DocumentType,
    example: DocumentType.TEXT
  })
  @IsEnum(DocumentType)
  type: DocumentType;

  @ApiPropertyOptional({ 
    description: '文档标题', 
    example: 'My English Document' 
  })
  @IsOptional()
  @IsString()
  title?: string;
}

export class DocumentResponseDto {
  @ApiProperty({ description: '文档唯一ID' })
  id: string;

  @ApiProperty({ description: '文档标题' })
  title: string;

  @ApiProperty({ description: '处理后的文档内容' })
  content: string;

  @ApiProperty({ description: '文档类型', enum: DocumentType })
  type: DocumentType;

  @ApiProperty({ description: '单词数量' })
  wordCount: number;

  @ApiProperty({ description: '句子数组', type: [String] })
  sentences: string[];

  @ApiProperty({ description: '创建时间' })
  createdAt: Date;
}