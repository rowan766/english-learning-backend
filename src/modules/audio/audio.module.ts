// src/modules/audio/audio.module.ts
import { Module } from '@nestjs/common';
import { AudioProcessingService } from './audio-processing.service';

@Module({
  providers: [AudioProcessingService],
  exports: [AudioProcessingService],
})
export class AudioModule {}