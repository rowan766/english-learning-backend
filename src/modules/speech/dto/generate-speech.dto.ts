// src/modules/speech/dto/generate-speech.dto.ts
import { IsString, IsOptional, IsEnum, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum VoiceId {
  JOANNA = 'Joanna',
  MATTHEW = 'Matthew',
  IVY = 'Ivy',
  JUSTIN = 'Justin',
  KENDRA = 'Kendra',
  KIMBERLY = 'Kimberly',
  SALLI = 'Salli',
  JOEY = 'Joey',
  RUTH = 'Ruth',
  STEPHEN = 'Stephen',
}

export enum OutputFormat {
  MP3 = 'mp3',
  OGG_VORBIS = 'ogg_vorbis',
  PCM = 'pcm',
}

export class GenerateSpeechDto {
  @ApiProperty({ 
    description: '要转换为语音的文本', 
    example: 'Hello, this is a test sentence for speech synthesis.',
    maxLength: 3000
  })
  @IsString()
  @MaxLength(3000, { message: '文本长度不能超过3000个字符' })
  text: string;

  @ApiPropertyOptional({ 
    description: '语音音色', 
    enum: VoiceId,
    default: VoiceId.JOANNA
  })
  @IsOptional()
  @IsEnum(VoiceId)
  voiceId?: VoiceId;

  @ApiPropertyOptional({ 
    description: '输出格式', 
    enum: OutputFormat,
    default: OutputFormat.MP3
  })
  @IsOptional()
  @IsEnum(OutputFormat)
  outputFormat?: OutputFormat;

  @ApiPropertyOptional({ 
    description: '语音文件名称（不含扩展名）' 
  })
  @IsOptional()
  @IsString()
  fileName?: string;
}

export class SpeechResponseDto {
  @ApiProperty({ description: '音频文件的S3 URL' })
  audioUrl: string;

  @ApiProperty({ description: '音频文件名' })
  fileName: string;

  @ApiProperty({ description: '音频时长（秒）' })
  duration: number;

  @ApiProperty({ description: '使用的音色' })
  voiceId: string;

  @ApiProperty({ description: '输出格式' })
  outputFormat: string;

  @ApiProperty({ description: '原始文本' })
  originalText: string;

  @ApiProperty({ description: '创建时间' })
  createdAt: Date;
}