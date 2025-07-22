// src/modules/document/document.controller.ts
import { 
  Controller, 
  Post, 
  Get,
  Delete,
  Body, 
  Param,
  Query,
  UseInterceptors, 
  UploadedFile,
  UploadedFiles,
  BadRequestException,
  HttpStatus,
  HttpCode,
  ParseIntPipe,
  DefaultValuePipe
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiResponse, ApiConsumes, ApiBody, ApiParam, ApiQuery } from '@nestjs/swagger';
import { DocumentService } from './document.service';
import { Express } from 'express';
import { 
  ProcessDocumentDto, 
  DocumentResponseDto, 
  DocumentType,
  ProcessDocumentWithAudioDto,
  DocumentAudioMatchDto,
  DocumentAudioMatchResponseDto
} from './dto/process-document.dto';

@ApiTags('document')
@Controller('document')
export class DocumentController {
  constructor(private readonly documentService: DocumentService) {}

  /**
   * 获取所有文档列表
   */
  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ 
    summary: '获取文档列表', 
    description: '分页获取所有文档记录' 
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
    description: '每页数量，最大50',
    example: 10
  })
  @ApiResponse({ 
    status: 200, 
    description: '获取成功', 
    type: [DocumentResponseDto] 
  })
  async getAllDocuments(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number
  ): Promise<DocumentResponseDto[]> {
    // 限制每页最大数量
    const take = Math.min(limit, 50);
    const skip = (page - 1) * take;
    
    return await this.documentService.getDocumentList(skip, take);
  }

  /**
   * 根据ID获取文档详情
   */
  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ 
    summary: '获取文档详情', 
    description: '根据ID获取特定文档的详细信息' 
  })
  @ApiParam({ 
    name: 'id', 
    description: '文档ID',
    example: 'uuid-format-string'
  })
  @ApiResponse({ 
    status: 200, 
    description: '获取成功', 
    type: DocumentResponseDto 
  })
  @ApiResponse({ 
    status: 404, 
    description: '文档未找到' 
  })
  async getDocumentById(@Param('id') id: string): Promise<DocumentResponseDto> {
    return await this.documentService.getDocumentById(id);
  }

  /**
   * 删除文档
   */
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ 
    summary: '删除文档', 
    description: '删除指定的文档及其所有关联数据' 
  })
  @ApiParam({ 
    name: 'id', 
    description: '文档ID',
    example: 'uuid-format-string'
  })
  @ApiResponse({ 
    status: 200, 
    description: '删除成功',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: '文档删除成功' }
      }
    }
  })
  @ApiResponse({ 
    status: 404, 
    description: '文档未找到' 
  })
  async deleteDocument(@Param('id') id: string): Promise<{ success: boolean; message: string }> {
    const result = await this.documentService.deleteDocument(id);
    
    if (result) {
      return {
        success: true,
        message: '文档删除成功'
      };
    } else {
      return {
        success: false,
        message: '文档未找到'
      };
    }
  }

  /**
   * 处理文本内容
   */
  @Post('process-text')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '处理文本内容', description: '解析文本内容，返回处理后的文档信息' })
  @ApiResponse({ status: 200, description: '处理成功', type: DocumentResponseDto })
  @ApiResponse({ status: 400, description: '请求参数错误' })
  async processText(@Body() processDocumentDto: ProcessDocumentDto): Promise<DocumentResponseDto> {
    return await this.documentService.processDocument(processDocumentDto);
  }

  /**
   * 处理文本内容并生成语音
   */
  @Post('process-text-with-audio')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ 
    summary: '处理文本内容并生成语音', 
    description: '解析文本内容并为每个段落生成语音文件' 
  })
  @ApiResponse({ status: 200, description: '处理成功', type: DocumentResponseDto })
  @ApiResponse({ status: 400, description: '请求参数错误' })
  async processTextWithAudio(
    @Body() processDocumentDto: ProcessDocumentWithAudioDto
  ): Promise<DocumentResponseDto> {
    return await this.documentService.processDocumentWithAudio(processDocumentDto);
  }

  /**
   * 上传并处理文件
   */
  @Post('upload')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ 
    summary: '上传文件', 
    description: '上传文档文件（支持 .txt、.pdf、.docx）并解析内容' 
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: '文件上传',
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: '支持 .txt、.pdf、.docx 文件'
        },
        title: {
          type: 'string',
          description: '可选的文档标题'
        }
      },
      required: ['file']
    }
  })
  @ApiResponse({ status: 200, description: '上传成功', type: DocumentResponseDto })
  @ApiResponse({ status: 400, description: '文件格式不支持或上传失败' })
  async uploadFile(
    @UploadedFile() file: Express.Multer.File,
    @Body('title') title?: string
  ): Promise<DocumentResponseDto> {
    if (!file) {
      throw new BadRequestException('请提供文件');
    }

    // 检查文件类型
    const documentType = this.getDocumentType(file.mimetype, file.originalname);
    if (!documentType) {
      throw new BadRequestException('不支持的文件类型，请上传 .txt、.pdf 或 .docx 文件');
    }

    // 提取文本内容
    const content = await this.extractTextFromFile(file, documentType);

    const processDocumentDto: ProcessDocumentDto = {
      content,
      type: documentType,
      title: title || this.getFileNameWithoutExtension(file.originalname),
    };

    return await this.documentService.processDocument(processDocumentDto);
  }

  /**
   * 上传并处理文件，同时生成语音
   */
  @Post('upload-with-audio')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ 
    summary: '上传文件并生成语音', 
    description: '上传文档文件并为每个段落生成语音' 
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: '文件上传和语音配置',
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: '支持 .txt、.pdf、.docx 文件'
        },
        title: {
          type: 'string',
          description: '可选的文档标题'
        },
        generateAudio: {
          type: 'boolean',
          description: '是否生成语音',
          default: true
        },
        voiceId: {
          type: 'string',
          description: '语音音色',
          default: 'Joanna'
        },
        outputFormat: {
          type: 'string',
          description: '音频格式',
          default: 'mp3'
        }
      },
      required: ['file']
    }
  })
  @ApiResponse({ status: 200, description: '上传成功', type: DocumentResponseDto })
  @ApiResponse({ status: 400, description: '文件格式不支持或上传失败' })
  async uploadFileWithAudio(
    @UploadedFile() file: Express.Multer.File,
    @Body('title') title?: string,
    @Body('generateAudio') generateAudio?: boolean,
    @Body('voiceId') voiceId?: string,
    @Body('outputFormat') outputFormat?: string
  ): Promise<DocumentResponseDto> {
    if (!file) {
      throw new BadRequestException('请提供文件');
    }

    // 检查文件类型
    const documentType = this.getDocumentType(file.mimetype, file.originalname);
    if (!documentType) {
      throw new BadRequestException('不支持的文件类型，请上传 .txt、.pdf 或 .docx 文件');
    }

    // 提取文本内容
    const content = await this.extractTextFromFile(file, documentType);

    const processDocumentDto: ProcessDocumentWithAudioDto = {
      content,
      type: documentType,
      title: title || this.getFileNameWithoutExtension(file.originalname),
      generateAudio: generateAudio !== false, // 默认为true
      voiceId: voiceId || 'Joanna',
      outputFormat: outputFormat || 'mp3',
    };

    return await this.documentService.processDocumentWithAudio(processDocumentDto);
  }

  /**
   * 上传文档和音频进行智能匹配
   */
  @Post('match-with-audio')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FilesInterceptor('files', 2)) // 接受2个文件
  @ApiOperation({ 
    summary: '文档音频智能匹配', 
    description: '同时上传文档和音频文件，自动建立段落与音频片段的对应关系' 
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: '文档和音频文件上传',
    schema: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          items: {
            type: 'string',
            format: 'binary'
          },
          description: '文档文件（.txt/.pdf/.docx）和音频文件（.mp3/.wav/.m4a等）'
        },
        title: {
          type: 'string',
          description: '文档标题'
        },
        segmentStrategy: {
          type: 'string',
          enum: ['silence', 'time', 'manual'],
          description: '音频分段策略',
          default: 'silence'
        },
        segmentDuration: {
          type: 'number',
          description: '时间分段时长（秒），strategy为time时使用',
          default: 30
        },
        silenceThreshold: {
          type: 'number',
          description: '静音检测阈值（0-1），strategy为silence时使用',
          default: 0.01
        },
        minSilenceDuration: {
          type: 'number',
          description: '最小静音时长（秒），strategy为silence时使用',
          default: 1.0
        }
      },
      required: ['files']
    }
  })
  @ApiResponse({ status: 200, description: '匹配成功', type: DocumentAudioMatchResponseDto })
  @ApiResponse({ status: 400, description: '文件格式不支持或匹配失败' })
  async matchDocumentWithAudio(
    @UploadedFiles() files: Express.Multer.File[],
    @Body('title') title?: string,
    @Body('segmentStrategy') segmentStrategy?: string,
    @Body('segmentDuration') segmentDuration?: string,
    @Body('silenceThreshold') silenceThreshold?: string,
    @Body('minSilenceDuration') minSilenceDuration?: string
  ): Promise<DocumentAudioMatchResponseDto> {
    if (!files || files.length !== 2) {
      throw new BadRequestException('请同时上传文档文件和音频文件（共2个文件）');
    }

    // 分别识别文档文件和音频文件
    let documentFile: Express.Multer.File | null = null;
    let audioFile: Express.Multer.File | null = null;

    for (const file of files) {
      if (this.isDocumentFile(file)) {
        documentFile = file;
      } else if (this.isAudioFile(file)) {
        audioFile = file;
      }
    }

    if (!documentFile) {
      throw new BadRequestException('未找到有效的文档文件（支持 .txt、.pdf、.docx）');
    }

    if (!audioFile) {
      throw new BadRequestException('未找到有效的音频文件（支持 .mp3、.wav、.m4a 等）');
    }

    // 构建匹配选项
    const matchOptions: DocumentAudioMatchDto = {
      title: title || this.getFileNameWithoutExtension(documentFile.originalname),
      documentType: this.getDocumentType(documentFile.mimetype, documentFile.originalname) ?? DocumentType.TEXT,
      segmentStrategy: (segmentStrategy as any) || 'silence',
      segmentDuration: segmentDuration ? parseFloat(segmentDuration) : 30,
      silenceThreshold: silenceThreshold ? parseFloat(silenceThreshold) : 0.01,
      minSilenceDuration: minSilenceDuration ? parseFloat(minSilenceDuration) : 1.0,
    };

    return await this.documentService.matchDocumentWithAudio(
      documentFile.buffer,
      audioFile.buffer,
      documentFile.originalname,
      audioFile.originalname,
      matchOptions
    );
  }

  // =================== 私有方法 ===================

  /**
   * 根据MIME类型和文件名确定文档类型
   */
  private getDocumentType(mimetype: string, filename: string): DocumentType | null {
    // 首先根据MIME类型判断
    switch (mimetype) {
      case 'text/plain':
        return DocumentType.TEXT;
      case 'application/pdf':
        return DocumentType.PDF;
      case 'application/msword':
      case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
        return DocumentType.WORD;
    }

    // 如果MIME类型无法识别，根据文件扩展名判断
    const extension = filename.toLowerCase().split('.').pop();
    switch (extension) {
      case 'txt':
        return DocumentType.TEXT;
      case 'pdf':
        return DocumentType.PDF;
      case 'doc':
      case 'docx':
        return DocumentType.WORD;
      default:
        return null;
    }
  }

  /**
   * 从文件中提取文本内容
   */
  private async extractTextFromFile(
    file: Express.Multer.File, 
    type: DocumentType
  ): Promise<string> {
    switch (type) {
      case DocumentType.TEXT:
        return file.buffer.toString('utf-8');
      
      case DocumentType.PDF:
        return await this.documentService.extractPdfText(file.buffer);
      
      case DocumentType.WORD:
        return await this.documentService.extractWordText(file.buffer);
      
      default:
        throw new BadRequestException('不支持的文档类型');
    }
  }

  /**
   * 获取不带扩展名的文件名
   */
  private getFileNameWithoutExtension(filename: string): string {
    return filename.replace(/\.[^/.]+$/, '');
  }

  /**
   * 检查是否为文档文件
   */
  private isDocumentFile(file: Express.Multer.File): boolean {
    const documentMimeTypes = [
      'text/plain',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];
    
    if (documentMimeTypes.includes(file.mimetype)) {
      return true;
    }
    
    const extension = file.originalname.toLowerCase().split('.').pop();
    return ['txt', 'pdf', 'doc', 'docx'].includes(extension || '');
  }

  /**
   * 检查是否为音频文件
   */
  private isAudioFile(file: Express.Multer.File): boolean {
    const audioMimeTypes = [
      'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/wave',
      'audio/x-wav', 'audio/mp4', 'audio/m4a', 'audio/aac',
      'audio/ogg', 'audio/webm'
    ];
    
    if (audioMimeTypes.includes(file.mimetype)) {
      return true;
    }
    
    const extension = file.originalname.toLowerCase().split('.').pop();
    return ['mp3', 'wav', 'wave', 'm4a', 'aac', 'ogg', 'webm'].includes(extension || '');
  }
}