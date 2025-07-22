// src/modules/speech/speech.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PollyClient, SynthesizeSpeechCommand } from '@aws-sdk/client-polly';
import { CacheService } from '../cache/cache.service';
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
    private readonly cacheService: CacheService,
  ) {
    const region = this.configService.get<string>('aws.region');
    const accessKeyId = this.configService.get<string>('aws.accessKeyId');
    const secretAccessKey = this.configService.get<string>('aws.secretAccessKey');

    // AWS Polly配置
    const awsConfig = {
      region,
      requestTimeout: 120000,     // 2分钟请求超时
      connectionTimeout: 60000,   // 1分钟连接超时
      maxAttempts: 5,             // 最大重试次数
      retryMode: 'adaptive',      // 自适应重试模式
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

  /**
   * 确保音频目录存在
   */
  private ensureAudioDirectoryExists(): void {
    if (!fs.existsSync(this.audioDir)) {
      fs.mkdirSync(this.audioDir, { recursive: true });
      this.logger.log(`创建音频目录: ${this.audioDir}`);
    }
  }

  /**
   * 生成语音
   */
  async generateSpeech(generateSpeechDto: GenerateSpeechDto): Promise<SpeechResponseDto> {
    const { text, voiceId = VoiceId.JOANNA, outputFormat = OutputFormat.MP3, fileName } = generateSpeechDto;

    // 生成缓存键
    const cacheKey = this.generateCacheKey(text, voiceId, outputFormat);

    // 检查缓存
    const cached = this.cacheService.get<SpeechResponseDto>(cacheKey);
    if (cached) {
      // 检查文件是否还存在
      const filePath = this.getAudioFilePath(cached.fileName, outputFormat);
      if (fs.existsSync(filePath)) {
        this.logger.log(`从缓存获取语音: ${cacheKey}`);
        return cached;
      } else {
        // 文件不存在，清除缓存
        this.cacheService.delete(cacheKey);
      }
    }

    try {
      this.logger.log(`开始生成语音，文本长度: ${text.length}`);
      
      // 使用AWS Polly生成语音
      const audioData = await this.synthesizeSpeech(text, voiceId, outputFormat);

      // 保存到本地文件
      const audioFileName = fileName || `speech_${uuidv4()}`;
      const audioUrl = await this.saveToLocal(audioData, audioFileName, outputFormat);

      // 估算音频时长 (粗略计算：约每分钟150个单词)
      const wordCount = text.split(' ').length;
      const estimatedDuration = Math.round((wordCount / 150) * 60);

      const result: SpeechResponseDto = {
        audioUrl,
        fileName: audioFileName,
        duration: estimatedDuration,
        voiceId,
        outputFormat,
        originalText: text,
        createdAt: new Date(),
      };

      // 存入缓存
      // this.cacheService.set(cacheKey, result);

      this.logger.log(`语音生成成功: ${audioFileName}`);
      return result;
    } catch (error) {
      this.logger.error(`语音生成失败: ${error.message}`, error.stack);
      
      // 如果是网络超时错误，提供更友好的错误信息
      if (error.message.includes('ETIMEDOUT') || error.message.includes('timeout')) {
        throw new Error('网络连接超时，请稍后重试或检查网络连接');
      }
      
      throw new Error(`语音生成失败: ${error.message}`);
    }
  }

  /**
   * 使用AWS Polly合成语音
   */
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

    // 将音频流转换为Uint8Array
    const chunks: any[] = [];
    const audioStream = response.AudioStream as any;
    
    // 处理不同类型的流
    if (audioStream.transformToByteArray) {
      // 如果有 transformToByteArray 方法，直接使用
      return await audioStream.transformToByteArray();
    } else {
      // 否则手动读取流
      for await (const chunk of audioStream) {
        chunks.push(chunk);
      }
      
      // 合并所有chunks
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

  /**
   * 保存音频到本地文件
   */
  private async saveToLocal(
    audioData: Uint8Array,
    fileName: string,
    outputFormat: OutputFormat,
  ): Promise<string> {
    const fullFileName = `${fileName}.${outputFormat}`;
    const filePath = this.getAudioFilePath(fileName, outputFormat);
    
    this.logger.log(`开始保存到本地: ${filePath}，文件大小: ${audioData.length} 字节`);
    
    try {
      // 写入文件
      fs.writeFileSync(filePath, audioData);
      
      // 返回可访问的URL（相对于静态文件服务的路径）
      const audioUrl = `/audio/${fullFileName}`;
      
      this.logger.log(`本地保存成功: ${audioUrl}`);
      return audioUrl;
      
    } catch (error) {
      this.logger.error(`本地保存失败: ${error.message}`, error.stack);
      throw new Error(`音频文件保存失败: ${error.message}`);
    }
  }

  /**
   * 获取音频文件完整路径
   */
  private getAudioFilePath(fileName: string, outputFormat: OutputFormat): string {
    return path.join(this.audioDir, `${fileName}.${outputFormat}`);
  }

  /**
   * 生成缓存键
   */
  private generateCacheKey(text: string, voiceId: VoiceId, outputFormat: OutputFormat): string {
    const hash = this.simpleHash(text);
    return `speech_${voiceId}_${outputFormat}_${hash}`;
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