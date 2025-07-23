// src/modules/audio/audio-processing.service.ts
import { Injectable, Logger } from '@nestjs/common';
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
    
    // 获取音频信息（简化版本，实际应用可能需要更复杂的音频分析）
    const audioInfo = await this.getAudioInfo(filePath);
    
    const audioUrl = `/audio/${fileName}`;
    
    this.logger.log(`音频文件保存成功: ${audioUrl}, 时长: ${audioInfo.duration}秒`);
    
    return { filePath, audioUrl, audioInfo };
  }

  /**
   * 获取音频文件信息（简化版本）
   */
  async getAudioInfo(filePath: string): Promise<AudioInfo> {
    // 这里是简化版本，实际项目中应该使用 ffprobe 或其他音频分析工具
    // 为了快速测试，我们返回估算值
    const stats = fs.statSync(filePath);
    const fileSizeInBytes = stats.size;
    
    // 粗略估算：假设是 128kbps 的 MP3
    const estimatedDuration = (fileSizeInBytes * 8) / (128 * 1000); // 转换为秒
    
    return {
      duration: Math.max(estimatedDuration, 10), // 最少10秒
      format: 'mp3',
      sampleRate: 44100,
      channels: 2,
    };
  }

  /**
   * 基于时长智能分割音频
   * 根据文本段落数量和音频总时长，智能分配时间段
   */
  async segmentByTextParagraphs(
    audioFilePath: string,
    paragraphCount: number,
    totalDuration: number
  ): Promise<AudioSegment[]> {
    this.logger.log(`开始智能分割音频: ${paragraphCount}个段落, 总时长: ${totalDuration}秒`);
    
    const segments: AudioSegment[] = [];
    const segmentDuration = totalDuration / paragraphCount;
    
    for (let i = 0; i < paragraphCount; i++) {
      const startTime = i * segmentDuration;
      const endTime = Math.min(startTime + segmentDuration, totalDuration);
      
      segments.push({
        startTime,
        endTime,
        duration: endTime - startTime,
      });
    }
    
    this.logger.log(`智能分割完成，共生成 ${segments.length} 个音频段落`);
    return segments;
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
   * 根据时间段切割音频文件（简化版本）
   */
  async extractAudioSegment(
    sourceFilePath: string,
    startTime: number,
    duration: number,
    outputFileName: string
  ): Promise<string> {
    const outputPath = path.join(this.audioDir, outputFileName);
    
    // 这里是简化版本，实际应该使用 ffmpeg
    // 为了快速测试，我们复制原文件并添加时间信息到文件名
    try {
      fs.copyFileSync(sourceFilePath, outputPath);
      
      const audioUrl = `/audio/${outputFileName}`;
      this.logger.log(`音频段落提取成功: ${audioUrl} (${startTime}s-${startTime + duration}s)`);
      return audioUrl;
      
    } catch (error) {
      throw new Error(`音频段落提取失败: ${error.message}`);
    }
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
        results.push(null);
      }
    }
    
    return results;
  }
}