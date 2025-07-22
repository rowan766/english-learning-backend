// src/modules/speech/speech.controller.ts
import { 
  Controller, 
  Post, 
  Get,
  Delete,
  Body, 
  Param,
  Query,
  HttpStatus,
  HttpCode,
  ParseIntPipe,
  DefaultValuePipe
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery } from '@nestjs/swagger';
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
    description: '将文本转换为语音，并保存到本地存储和数据库' 
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

  /**
   * 获取所有语音记录
   */
  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ 
    summary: '获取语音记录列表', 
    description: '分页获取所有语音记录' 
  })
  @ApiQuery({ 
    name: 'page', 
    required: false, 
    type: Number, 
    description: '页码，从1开始',
    example: 1
  })
  @ApiQuery({ 
    name: 'limit', 
    required: false, 
    type: Number, 
    description: '每页数量，最大100',
    example: 20
  })
  @ApiResponse({ 
    status: 200, 
    description: '获取成功', 
    type: [SpeechResponseDto] 
  })
  async getAllSpeeches(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number
  ): Promise<SpeechResponseDto[]> {
    // 限制每页最大数量
    const take = Math.min(limit, 100);
    const skip = (page - 1) * take;
    
    return await this.speechService.getAllSpeeches(skip, take);
  }

  /**
   * 根据ID获取语音记录
   */
  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ 
    summary: '获取语音记录详情', 
    description: '根据ID获取特定的语音记录' 
  })
  @ApiParam({ 
    name: 'id', 
    description: '语音记录ID',
    example: 'uuid-format-string'
  })
  @ApiResponse({ 
    status: 200, 
    description: '获取成功', 
    type: SpeechResponseDto 
  })
  @ApiResponse({ 
    status: 404, 
    description: '语音记录未找到' 
  })
  async getSpeechById(@Param('id') id: string): Promise<SpeechResponseDto> {
    return await this.speechService.getSpeechById(id);
  }

  /**
   * 删除语音记录
   */
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ 
    summary: '删除语音记录', 
    description: '删除指定的语音记录及其对应的音频文件' 
  })
  @ApiParam({ 
    name: 'id', 
    description: '语音记录ID',
    example: 'uuid-format-string'
  })
  @ApiResponse({ 
    status: 200, 
    description: '删除成功',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: '语音记录删除成功' }
      }
    }
  })
  @ApiResponse({ 
    status: 404, 
    description: '语音记录未找到' 
  })
  async deleteSpeech(@Param('id') id: string): Promise<{ success: boolean; message: string }> {
    const result = await this.speechService.deleteSpeech(id);
    
    if (result) {
      return {
        success: true,
        message: '语音记录删除成功'
      };
    } else {
      return {
        success: false,
        message: '语音记录未找到'
      };
    }
  }
}