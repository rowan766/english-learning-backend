// src/modules/speech/speech.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PollyClient, SynthesizeSpeechCommand } from '@aws-sdk/client-polly';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { CacheService } from '../cache/cache.service';
import { GenerateSpeechDto, SpeechResponseDto, VoiceId, OutputFormat } from './dto/generate-speech.dto';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class SpeechService {
  private readonly logger = new Logger(SpeechService.name);
  private readonly pollyClient: PollyClient;
  private readonly s3Client: S3Client;
  private readonly bucketName: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly cacheService: CacheService,
  ) {
    const region = this.configService.get<string>('aws.region');
    const accessKeyId = this.configService.get<string>('aws.accessKeyId');
    const secretAccessKey = this.configService.get<string>('aws.secretAccessKey');

    // 增强的AWS配置，添加超时和重试设置
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
    this.s3Client = new S3Client(awsConfig);
    this.bucketName = this.configService.get<string>('aws.s3.bucketName') || 'english-learning-audio';
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
      this.logger.log(`从缓存获取语音: ${cacheKey}`);
      return cached;
    }

    try {
      this.logger.log(`开始生成语音，文本长度: ${text.length}`);
      
      // 使用AWS Polly生成语音
      const audioData = await this.synthesizeSpeech(text, voiceId, outputFormat);

      // 上传到S3
      const audioFileName = fileName || `speech_${uuidv4()}`;
      const s3Key = `${audioFileName}.${outputFormat}`;
      const audioUrl = await this.uploadToS3(audioData, s3Key, outputFormat);

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
      this.cacheService.set(cacheKey, result);

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
   * 上传音频到S3
   */
  private async uploadToS3(
    audioData: Uint8Array,
    key: string,
    outputFormat: OutputFormat,
  ): Promise<string> {
    this.logger.log(`开始上传到S3: ${key}，文件大小: ${audioData.length} 字节`);
    
    const contentType = this.getContentType(outputFormat);

    // 增加S3上传的重试机制
    let retryCount = 0;
    const maxRetries = 3;
    
    while (retryCount < maxRetries) {
      try {
        const command = new PutObjectCommand({
          Bucket: this.bucketName,
          Key: key,
          Body: audioData,
          ContentType: contentType,
          ACL: 'public-read', // 设置为公开可读
        });

        await this.s3Client.send(command);

        // 返回S3对象的公开URL
        const region = this.configService.get<string>('aws.s3.region');
        const audioUrl = `https://${this.bucketName}.s3.${region}.amazonaws.com/${key}`;
        
        this.logger.log(`S3上传成功: ${audioUrl}`);
        return audioUrl;
        
      } catch (error) {
        retryCount++;
        this.logger.warn(`S3上传失败，重试 ${retryCount}/${maxRetries}: ${error.message}`);
        
        if (retryCount >= maxRetries) {
          throw error;
        }
        
        // 等待后重试
        await new Promise<void>(resolve => setTimeout(resolve, 2000 * retryCount));
      }
    }
    
    // TypeScript要求的返回语句（虽然永远不会执行到这里）
    throw new Error('S3上传失败，已达到最大重试次数');
  }

  /**
   * 获取内容类型
   */
  private getContentType(outputFormat: OutputFormat): string {
    switch (outputFormat) {
      case OutputFormat.MP3:
        return 'audio/mpeg';
      case OutputFormat.OGG_VORBIS:
        return 'audio/ogg';
      case OutputFormat.PCM:
        return 'audio/pcm';
      default:
        return 'audio/mpeg';
    }
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