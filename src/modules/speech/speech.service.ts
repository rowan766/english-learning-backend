// src/modules/speech/speech.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PollyClient, SynthesizeSpeechCommand } from '@aws-sdk/client-polly';
import { PrismaService } from '../../prisma/prisma.service';
import { GenerateSpeechDto, SpeechResponseDto, VoiceId, OutputFormat } from './dto/generate-speech.dto';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class SpeechService {
  private readonly logger = new Logger(SpeechService.name);
  private readonly pollyClient: PollyClient;
  private readonly audioDir: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    // 更新配置路径以匹配新的配置结构
    const region = this.configService.get<string>('aws.region') || this.configService.get<string>('AWS_REGION') || 'us-east-2';
    const accessKeyId = this.configService.get<string>('aws.accessKeyId') || this.configService.get<string>('AWS_ACCESS_KEY_ID');
    const secretAccessKey = this.configService.get<string>('aws.secretAccessKey') || this.configService.get<string>('AWS_SECRET_ACCESS_KEY');

    // AWS Polly配置
    const awsConfig = {
      region,
      requestTimeout: 120000,
      connectionTimeout: 60000,
      maxAttempts: 5,
      retryMode: 'adaptive',
      ...(accessKeyId && secretAccessKey && {
        credentials: {
          accessKeyId,
          secretAccessKey,
        },
      }),
    };

    this.pollyClient = new PollyClient(awsConfig);
    
    // 设置本地音频存储目录
    this.audioDir = path.join(process.cwd(), 'public', 'audio');
    this.ensureAudioDirectoryExists();
  }

  private ensureAudioDirectoryExists(): void {
    if (!fs.existsSync(this.audioDir)) {
      fs.mkdirSync(this.audioDir, { recursive: true });
      this.logger.log(`创建音频目录: ${this.audioDir}`);
    }
  }

  async generateSpeech(generateSpeechDto: GenerateSpeechDto): Promise<SpeechResponseDto> {
    const { text, voiceId = VoiceId.JOANNA, outputFormat = OutputFormat.MP3, fileName } = generateSpeechDto;

    const cacheKey = this.generateCacheKey(text, voiceId, outputFormat);

    // 使用新的模型名称查询（如果使用了英语学习专用表）
    const existingSpeech = await this.findExistingSpeech(cacheKey);
    if (existingSpeech) {
      const filePath = this.getAudioFilePath(existingSpeech.fileName, outputFormat);
      if (fs.existsSync(filePath)) {
        this.logger.log(`从数据库获取语音: ${existingSpeech.fileName}`);
        return this.formatSpeechResponse(existingSpeech);
      } else {
        // 使用新的模型名称删除
        await this.prisma.englishSpeechRecord.delete({
          where: { id: existingSpeech.id }
        });
      }
    }

    try {
      this.logger.log(`开始生成语音，文本长度: ${text.length}`);
      
      const audioData = await this.synthesizeSpeech(text, voiceId, outputFormat);
      const audioFileName = fileName || `speech_${uuidv4()}`;
      const audioUrl = await this.saveToLocal(audioData, audioFileName, outputFormat);

      const wordCount = text.split(' ').length;
      const estimatedDuration = Math.round((wordCount / 150) * 60);

      // 使用新的模型名称创建记录
      const speechRecord = await this.prisma.englishSpeechRecord.create({
        data: {
          id: uuidv4(),
          cacheKey,
          fileName: audioFileName,
          audioUrl,
          duration: estimatedDuration,
          voiceId,
          outputFormat,
          originalText: text,
          wordCount,
        }
      });

      this.logger.log(`语音生成成功: ${audioFileName}`);
      return this.formatSpeechResponse(speechRecord);
    } catch (error) {
      this.logger.error(`语音生成失败: ${error.message}`, error.stack);
      
      if (error.message.includes('ETIMEDOUT') || error.message.includes('timeout')) {
        throw new Error('网络连接超时，请稍后重试或检查网络连接');
      }
      
      throw new Error(`语音生成失败: ${error.message}`);
    }
  }

  async getSpeechById(id: string): Promise<SpeechResponseDto> {
    const speechRecord = await this.prisma.englishSpeechRecord.findUnique({
      where: { id }
    });

    if (!speechRecord) {
      throw new Error(`语音记录未找到: ${id}`);
    }

    return this.formatSpeechResponse(speechRecord);
  }

  async getAllSpeeches(skip: number = 0, take: number = 20): Promise<SpeechResponseDto[]> {
    const speechRecords = await this.prisma.englishSpeechRecord.findMany({
      skip,
      take,
      orderBy: { createdAt: 'desc' }
    });

    return speechRecords.map(record => this.formatSpeechResponse(record));
  }

  async deleteSpeech(id: string): Promise<boolean> {
    try {
      const speechRecord = await this.prisma.englishSpeechRecord.findUnique({
        where: { id }
      });

      if (speechRecord) {
        const filePath = this.getAudioFilePath(speechRecord.fileName, speechRecord.outputFormat as OutputFormat);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          this.logger.log(`删除音频文件: ${filePath}`);
        }

        await this.prisma.englishSpeechRecord.delete({
          where: { id }
        });

        this.logger.log(`语音记录删除成功: ${id}`);
        return true;
      }

      return false;
    } catch (error) {
      this.logger.error(`删除语音记录失败: ${error.message}`, error.stack);
      throw new Error(`删除语音记录失败: ${error.message}`);
    }
  }

  // =================== 私有方法 ===================

  private async findExistingSpeech(cacheKey: string) {
    return await this.prisma.englishSpeechRecord.findFirst({
      where: { cacheKey }
    });
  }

  private formatSpeechResponse(speechRecord: any): SpeechResponseDto {
    return {
      audioUrl: speechRecord.audioUrl,
      fileName: speechRecord.fileName,
      duration: speechRecord.duration,
      voiceId: speechRecord.voiceId,
      outputFormat: speechRecord.outputFormat,
      originalText: speechRecord.originalText,
      createdAt: speechRecord.createdAt,
    };
  }

  // 其他私有方法保持不变
  private async synthesizeSpeech(
    text: string,
    voiceId: VoiceId,
    outputFormat: OutputFormat,
  ): Promise<Uint8Array> {
    this.logger.log(`调用AWS Polly开始合成语音`);
    
    const command = new SynthesizeSpeechCommand({
      Text: text,
      VoiceId: voiceId,
      OutputFormat: outputFormat,
      TextType: 'text',
    });

    const response = await this.pollyClient.send(command);
    
    if (!response.AudioStream) {
      throw new Error('AWS Polly 未返回音频数据');
    }

    this.logger.log('AWS Polly响应成功，开始处理音频流');

    const chunks: any[] = [];
    const audioStream = response.AudioStream as any;
    
    if (audioStream.transformToByteArray) {
      return await audioStream.transformToByteArray();
    } else {
      for await (const chunk of audioStream) {
        chunks.push(chunk);
      }
      
      const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
      const result = new Uint8Array(totalLength);
      let offset = 0;
      
      for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
      }
      
      this.logger.log(`音频流处理完成，总大小: ${totalLength} 字节`);
      return result;
    }
  }

  private async saveToLocal(
    audioData: Uint8Array,
    fileName: string,
    outputFormat: OutputFormat,
  ): Promise<string> {
    const fullFileName = `${fileName}.${outputFormat}`;
    const filePath = this.getAudioFilePath(fileName, outputFormat);
    
    this.logger.log(`开始保存到本地: ${filePath}，文件大小: ${audioData.length} 字节`);
    
    try {
      fs.writeFileSync(filePath, audioData);
      const audioUrl = `/audio/${fullFileName}`;
      
      this.logger.log(`本地保存成功: ${audioUrl}`);
      return audioUrl;
      
    } catch (error) {
      this.logger.error(`本地保存失败: ${error.message}`, error.stack);
      throw new Error(`音频文件保存失败: ${error.message}`);
    }
  }

  private getAudioFilePath(fileName: string, outputFormat: OutputFormat): string {
    return path.join(this.audioDir, `${fileName}.${outputFormat}`);
  }

  private generateCacheKey(text: string, voiceId: VoiceId, outputFormat: OutputFormat): string {
    const hash = this.simpleHash(text);
    return `speech_${voiceId}_${outputFormat}_${hash}`;
  }

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