// src/modules/document/document.controller.ts
import { 
  Controller, 
  Post, 
  Body, 
  UseInterceptors, 
  UploadedFile,
  BadRequestException,
  HttpStatus,
  HttpCode
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiResponse, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { DocumentService } from './document.service';
import { 
  ProcessDocumentDto, 
  DocumentResponseDto, 
  DocumentType,
  ProcessDocumentWithAudioDto
} from './dto/process-document.dto';

@ApiTags('document')
@Controller('document')
export class DocumentController {
  constructor(private readonly documentService: DocumentService) {}

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
}