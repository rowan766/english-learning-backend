// src/app.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import appConfig from './config/app.config';
import awsConfig from './config/aws.config';
import { DocumentModule } from './modules/document/document.module';
import { SpeechModule } from './modules/speech/speech.module';
import { AudioModule } from './modules/audio/audio.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, awsConfig],
      envFilePath: '.env',
    }),
    PrismaModule,      // Prisma数据库模块
    AudioModule,       // 音频处理模块
    DocumentModule,    // 文档处理模块
    SpeechModule,      // 语音合成模块
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}