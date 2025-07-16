// src/config/app.config.ts
import { registerAs } from '@nestjs/config';

export default registerAs('app', () => ({
  port: parseInt(process.env.PORT || '3000', 10),
  environment: process.env.NODE_ENV || 'development',
  cache: {
    ttl: parseInt(process.env.CACHE_TTL || '604800', 10), // 1周
    max: parseInt(process.env.CACHE_MAX || '100', 10),  // 最大缓存数量
  },
  upload: {
    maxFileSize: parseInt(process.env.MAX_FILE_SIZE || '209715200', 10), // 200MB
    allowedMimeTypes: [
      'text/plain',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ],
  },
}));