// src/modules/document/document.module.ts
import { Module } from '@nestjs/common';
import { DocumentController } from './document.controller';
import { DocumentService } from './document.service';
import { SpeechModule } from '../speech/speech.module';
import { AudioModule } from '../audio/audio.module';

@Module({
  imports: [SpeechModule, AudioModule], // 导入SpeechModule和AudioModule
  controllers: [DocumentController],
  providers: [DocumentService],
  exports: [DocumentService],
})
export class DocumentModule {}