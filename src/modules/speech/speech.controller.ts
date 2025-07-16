// src/modules/speech/speech.controller.ts
import { 
  Controller, 
  Post, 
  Body, 
  HttpStatus,
  HttpCode
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { SpeechService } from './speech.service';
import { GenerateSpeechDto, SpeechResponseDto } from './dto/generate-speech.dto';

@ApiTags('speech')
@Controller('speech')
export class SpeechController {
  constructor(private readonly speechService: SpeechService) {}

  /**
   * 生成语音
   */
  @Post('generate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ 
    summary: '生成语音', 
    description: '将文本转换为语音，并上传到S3存储' 
  })
  @ApiResponse({ 
    status: 200, 
    description: '语音生成成功', 
    type: SpeechResponseDto 
  })
  @ApiResponse({ 
    status: 400, 
    description: '请求参数错误' 
  })
  @ApiResponse({ 
    status: 500, 
    description: 'AWS服务调用失败' 
  })
  async generateSpeech(@Body() generateSpeechDto: GenerateSpeechDto): Promise<SpeechResponseDto> {
    return await this.speechService.generateSpeech(generateSpeechDto);
  }
}