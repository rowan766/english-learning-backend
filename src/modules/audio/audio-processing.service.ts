// src/modules/audio/audio-processing.service.ts
import { Injectable, Logger } from '@nestjs/common';
import * as ffmpeg from 'fluent-ffmpeg';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';

export interface AudioSegment {
  startTime: number;
  endTime: number;
  duration: number;
}

export interface AudioInfo {
  duration: number;
  format: string;
  sampleRate: number;
  channels: number;
}

@Injectable()
export class AudioProcessingService {
  private readonly logger = new Logger(AudioProcessingService.name);
  private readonly audioDir: string;
  private readonly tempDir: string;

  constructor() {
    this.audioDir = path.join(process.cwd(), 'public', 'audio');
    this.tempDir = path.join(process.cwd(), 'temp');
    this.ensureDirectoriesExist();
  }

  /**
   * 确保必要的目录存在
   */
  private ensureDirectoriesExist(): void {
    [this.audioDir, this.tempDir].forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        this.logger.log(`创建目录: ${dir}`);
      }
    });
  }

  /**
   * 保存上传的音频文件
   */
  async saveAudioFile(buffer: Buffer, originalName: string): Promise<{ filePath: string; audioUrl: string; audioInfo: AudioInfo }> {
    const fileId = uuidv4();
    const extension = path.extname(originalName).toLowerCase();
    const fileName = `${fileId}${extension}`;
    const filePath = path.join(this.audioDir, fileName);

    // 保存文件
    fs.writeFileSync(filePath, buffer);
    
    // 获取音频信息
    const audioInfo = await this.getAudioInfo(filePath);
    
    const audioUrl = `/audio/${fileName}`;
    
    this.logger.log(`音频文件保存成功: ${audioUrl}, 时长: ${audioInfo.duration}秒`);
    
    return { filePath, audioUrl, audioInfo };
  }

  /**
   * 获取音频文件信息
   */
  async getAudioInfo(filePath: string): Promise<AudioInfo> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(filePath, (err, metadata) => {
        if (err) {
          reject(new Error(`获取音频信息失败: ${err.message}`));
          return;
        }

        const audioStream = metadata.streams.find(stream => stream.codec_type === 'audio');
        if (!audioStream) {
          reject(new Error('未找到音频流'));
          return;
        }

        resolve({
          duration: metadata.format.duration || 0,
          format: metadata.format.format_name || 'unknown',
          sampleRate: audioStream.sample_rate || 0,
          channels: audioStream.channels || 0,
        });
      });
    });
  }

  /**
   * 基于静音检测分割音频
   */
  async segmentBysilence(
    audioFilePath: string,
    silenceThreshold: number = 0.01,
    minSilenceDuration: number = 1.0
  ): Promise<AudioSegment[]> {
    this.logger.log(`开始静音检测分割音频: ${audioFilePath}`);
    
    return new Promise((resolve, reject) => {
      const segments: AudioSegment[] = [];
      const tempOutputPath = path.join(this.tempDir, `silence_detect_${uuidv4()}.txt`);

      // 使用FFmpeg的silencedetect滤镜
      ffmpeg(audioFilePath)
        .audioFilters([
          {
            filter: 'silencedetect',
            options: {
              noise: silenceThreshold,
              duration: minSilenceDuration,
            },
          },
        ])
        .format('null')
        .output('-')
        .on('stderr', (stderrLine) => {
          // 解析静音检测输出
          const silenceStartMatch = stderrLine.match(/silence_start: ([\d.]+)/);
          const silenceEndMatch = stderrLine.match(/silence_end: ([\d.]+)/);
          
          if (silenceStartMatch || silenceEndMatch) {
            this.logger.debug(`静音检测: ${stderrLine}`);
          }
        })
        .on('end', async () => {
          try {
            // 获取音频总时长
            const audioInfo = await this.getAudioInfo(audioFilePath);
            
            // 这里需要实现更复杂的静音分析逻辑
            // 简化版本：按固定时长分割作为备选方案
            const segmentDuration = 30; // 30秒一段
            const totalDuration = audioInfo.duration;
            
            for (let start = 0; start < totalDuration; start += segmentDuration) {
              const end = Math.min(start + segmentDuration, totalDuration);
              segments.push({
                startTime: start,
                endTime: end,
                duration: end - start,
              });
            }
            
            this.logger.log(`静音检测完成，共生成 ${segments.length} 个段落`);
            resolve(segments);
          } catch (error) {
            reject(error);
          }
        })
        .on('error', (err) => {
          reject(new Error(`静音检测失败: ${err.message}`));
        })
        .run();
    });
  }

  /**
   * 基于固定时长分割音频
   */
  async segmentByTime(audioFilePath: string, segmentDuration: number = 30): Promise<AudioSegment[]> {
    this.logger.log(`基于时长分割音频: ${audioFilePath}, 段落时长: ${segmentDuration}秒`);
    
    const audioInfo = await this.getAudioInfo(audioFilePath);
    const segments: AudioSegment[] = [];
    
    for (let start = 0; start < audioInfo.duration; start += segmentDuration) {
      const end = Math.min(start + segmentDuration, audioInfo.duration);
      segments.push({
        startTime: start,
        endTime: end,
        duration: end - start,
      });
    }
    
    this.logger.log(`时长分割完成，共生成 ${segments.length} 个段落`);
    return segments;
  }

  /**
   * 根据时间段切割音频文件
   */
  async extractAudioSegment(
    sourceFilePath: string,
    startTime: number,
    duration: number,
    outputFileName: string
  ): Promise<string> {
    const outputPath = path.join(this.audioDir, outputFileName);
    
    return new Promise((resolve, reject) => {
      ffmpeg(sourceFilePath)
        .seekInput(startTime)
        .duration(duration)
        .output(outputPath)
        .on('end', () => {
          const audioUrl = `/audio/${outputFileName}`;
          this.logger.log(`音频段落提取成功: ${audioUrl}`);
          resolve(audioUrl);
        })
        .on('error', (err) => {
          reject(new Error(`音频段落提取失败: ${err.message}`));
        })
        .run();
    });
  }

  /**
   * 批量生成音频段落文件
   */
  async generateSegmentAudios(
    sourceFilePath: string,
    segments: AudioSegment[],
    baseFileName: string
  ): Promise<Array<{ segmentId: string; audioUrl: string; segment: AudioSegment } | null>> {
    const results: Array<{ segmentId: string; audioUrl: string; segment: AudioSegment } | null> = [];
    
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const segmentId = uuidv4();
      const outputFileName = `${baseFileName}_segment_${i + 1}_${segmentId}.mp3`;
      
      try {
        const audioUrl = await this.extractAudioSegment(
          sourceFilePath,
          segment.startTime,
          segment.duration,
          outputFileName
        );
        
        results.push({
          segmentId,
          audioUrl,
          segment,
        });
      } catch (error) {
        this.logger.error(`生成第${i + 1}个音频段落失败: ${error.message}`);
        // 添加null以保持索引对应
        results.push(null);
      }
    }
    
    return results;
  }

  /**
   * 清理临时文件
   */
  async cleanupTempFiles(filePaths: string[]): Promise<void> {
    for (const filePath of filePaths) {
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          this.logger.debug(`清理临时文件: ${filePath}`);
        }
      } catch (error) {
        this.logger.warn(`清理临时文件失败: ${filePath}, ${error.message}`);
      }
    }
  }
}