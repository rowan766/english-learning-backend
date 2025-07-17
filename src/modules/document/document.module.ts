// src/modules/document/document.module.ts
import { Module } from '@nestjs/common';
import { DocumentController } from './document.controller';
import { DocumentService } from './document.service';
import { SpeechModule } from '../speech/speech.module';

@Module({
  imports: [SpeechModule], // 导入SpeechModule以使用SpeechService
  controllers: [DocumentController],
  providers: [DocumentService],
  exports: [DocumentService],
})
export class DocumentModule {}