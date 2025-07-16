// src/main.ts
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  // 获取配置服务
  const configService = app.get(ConfigService);
  
  // 启用全局验证管道
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }));
  
  // 启用CORS（如果需要前端调用）
  app.enableCors({
    origin: true,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  });

    const config = new DocumentBuilder()
    .setTitle('英语学习应用 API')
    .setDescription('文档解析、语音生成等功能的API文档')
    .setVersion('1.0')
    .addTag('document', '文档处理')
    .addTag('speech', '语音生成')
    .build();
  
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);
  
  
  // 从配置中获取端口
  const port = configService.get<number>('app.port') || 8002;
  
  await app.listen(port);
  console.log(`应用程序运行在: http://localhost:${port}`);
}

bootstrap();