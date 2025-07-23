// src/config/app.config.ts
export default () => ({
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  cors: {
    origin: process.env.CORS_ORIGIN?.split(',') || ['http://localhost:3000'],
  },
  upload: {
    maxFileSize: parseInt(process.env.MAX_FILE_SIZE || '209715200', 10),
    supportedTypes: process.env.SUPPORTED_FILE_TYPES?.split(',') || ['txt', 'pdf', 'docx'],
    maxTextLength: parseInt(process.env.MAX_TEXT_LENGTH || '50000', 10),
  },
  audio: {
    storagePath: process.env.AUDIO_STORAGE_PATH || './public/audio',
    maxDuration: parseInt(process.env.MAX_AUDIO_DURATION || '300', 10),
  },
});