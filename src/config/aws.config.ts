// src/config/aws.config.ts
import { registerAs } from '@nestjs/config';

export default registerAs('aws', () => ({
  region: process.env.AWS_REGION || 'us-east-1',
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  polly: {
    voiceId: process.env.POLLY_VOICE_ID || 'Joanna',
    outputFormat: process.env.POLLY_OUTPUT_FORMAT || 'mp3',
    textType: process.env.POLLY_TEXT_TYPE || 'text',
  },
  s3: {
    bucketName: process.env.S3_BUCKET_NAME || 'english-learning-audio',
    region: process.env.S3_REGION || 'us-east-1',
  },
}));