// src/app.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import appConfig from './config/app.config';
import awsConfig from './config/aws.config';
import { CacheModule } from './modules/cache/cache.module';
import { DocumentModule } from './modules/document/document.module';
import { SpeechModule } from './modules/speech/speech.module';
import { PrismaModule } from './prisma/prisma.module';  // 添加这行

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, awsConfig],
      envFilePath: '.env',
    }),
    PrismaModule,     // 添加这行
    CacheModule,
    DocumentModule,
    SpeechModule,
    // 后面会添加其他模块
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}