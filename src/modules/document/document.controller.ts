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
import { ProcessDocumentDto, DocumentResponseDto, DocumentType } from './dto/process-document.dto';

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
   * 上传并处理文件
   */
  @Post('upload')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: '上传文件', description: '上传文档文件并解析内容' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: '文件上传',
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: '支持 .txt 文件（PDF和Word暂未实现）'
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
    const documentType = this.getDocumentType(file.mimetype);
    if (!documentType) {
      throw new BadRequestException('不支持的文件类型');
    }

    // 提取文本内容
    const content = await this.extractTextFromFile(file, documentType);

    const processDocumentDto: ProcessDocumentDto = {
      content,
      type: documentType,
      title: title || file.originalname,
    };

    return await this.documentService.processDocument(processDocumentDto);
  }

  /**
   * 根据MIME类型确定文档类型
   */
  private getDocumentType(mimetype: string): DocumentType | null {
    switch (mimetype) {
      case 'text/plain':
        return DocumentType.TEXT;
      case 'application/pdf':
        return DocumentType.PDF;
      case 'application/msword':
      case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
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
        // TODO: 实现PDF文本提取 (可以使用 pdf-parse 库)
        throw new BadRequestException('PDF文件处理功能暂未实现');
      
      case DocumentType.WORD:
        // TODO: 实现Word文档文本提取 (可以使用 mammoth 库)
        throw new BadRequestException('Word文档处理功能暂未实现');
      
      default:
        throw new BadRequestException('不支持的文档类型');
    }
  }
}