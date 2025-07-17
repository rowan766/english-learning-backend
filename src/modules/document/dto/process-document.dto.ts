// src/modules/document/dto/process-document.dto.ts
import { IsString, IsOptional, IsEnum, IsArray } from 'class-validator';
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

// 段落信息
export class ParagraphDto {
  @ApiProperty({ description: '段落ID' })
  id: string;

  @ApiProperty({ description: '段落内容' })
  content: string;

  @ApiProperty({ description: '段落在文档中的序号' })
  order: number;

  @ApiProperty({ description: '段落单词数' })
  wordCount: number;

  @ApiProperty({ description: '段落包含的句子', type: [String] })
  sentences: string[];

  @ApiPropertyOptional({ description: '关联的语音文件URL' })
  audioUrl?: string;

  @ApiPropertyOptional({ description: '语音文件名' })
  audioFileName?: string;

  @ApiPropertyOptional({ description: '语音时长（秒）' })
  audioDuration?: number;
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

  @ApiProperty({ description: '总单词数量' })
  wordCount: number;

  @ApiProperty({ description: '总句子数量' })
  sentenceCount: number;

  @ApiProperty({ description: '段落数量' })
  paragraphCount: number;

  @ApiProperty({ description: '段落列表', type: [ParagraphDto] })
  paragraphs: ParagraphDto[];

  @ApiProperty({ description: '创建时间' })
  createdAt: Date;
}

// 文档和语音一键处理的DTO
export class ProcessDocumentWithAudioDto extends ProcessDocumentDto {
  @ApiPropertyOptional({ 
    description: '是否为每个段落生成语音', 
    default: true 
  })
  @IsOptional()
  generateAudio?: boolean;

  @ApiPropertyOptional({ 
    description: '语音音色',
    example: 'Joanna'
  })
  @IsOptional()
  @IsString()
  voiceId?: string;

  @ApiPropertyOptional({ 
    description: '音频格式',
    example: 'mp3'
  })
  @IsOptional()
  @IsString()
  outputFormat?: string;
}

// 音频段落信息
export class AudioSegmentDto {
  @ApiProperty({ description: '音频段落ID' })
  id: string;

  @ApiProperty({ description: '开始时间（秒）' })
  startTime: number;

  @ApiProperty({ description: '结束时间（秒）' })
  endTime: number;

  @ApiProperty({ description: '段落音频文件URL' })
  segmentAudioUrl: string;

  @ApiProperty({ description: '音频时长（秒）' })
  duration: number;

  @ApiProperty({ description: '段落顺序' })
  order: number;
}

// 文档与音频匹配的DTO
export class DocumentAudioMatchDto {
  @ApiProperty({ description: '文档标题' })
  @IsString()
  title: string;

  @ApiPropertyOptional({ description: '文档类型', enum: DocumentType })
  @IsOptional()
  @IsEnum(DocumentType)
  documentType?: DocumentType;

  @ApiPropertyOptional({ 
    description: '音频分段策略',
    enum: ['silence', 'time', 'manual'],
    example: 'silence'
  })
  @IsOptional()
  @IsString()
  segmentStrategy?: 'silence' | 'time' | 'manual';

  @ApiPropertyOptional({ 
    description: '时间分段时长（秒），当策略为time时使用',
    example: 30
  })
  @IsOptional()
  segmentDuration?: number;

  @ApiPropertyOptional({ 
    description: '静音检测阈值（0-1），当策略为silence时使用',
    example: 0.01
  })
  @IsOptional()
  silenceThreshold?: number;

  @ApiPropertyOptional({ 
    description: '最小静音时长（秒），当策略为silence时使用',
    example: 1.0
  })
  @IsOptional()
  minSilenceDuration?: number;
}

// 匹配结果的响应DTO
export class DocumentAudioMatchResponseDto extends DocumentResponseDto {
  @ApiProperty({ description: '原始音频文件URL' })
  originalAudioUrl: string;

  @ApiProperty({ description: '原始音频时长（秒）' })
  originalAudioDuration: number;

  @ApiProperty({ description: '音频段落列表', type: [AudioSegmentDto] })
  audioSegments: AudioSegmentDto[];

  @ApiProperty({ description: '匹配策略' })
  matchStrategy: string;

  @ApiProperty({ description: '是否需要手动调整匹配' })
  needsManualAdjustment: boolean;
}