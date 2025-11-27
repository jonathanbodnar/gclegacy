import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().default(4000),
  API_PREFIX: z.string().default('/v1'),
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_EXPIRES_IN: z.string().default('24h'),
  DEFAULT_CLIENT_ID: z.string().min(1),
  DEFAULT_CLIENT_SECRET: z.string().min(1),
  DEFAULT_CLIENT_NAME: z.string().min(1),
  STORAGE_DIR: z.string().default('./storage/uploads'),
  JOB_PROCESSING_DELAY_MS: z.coerce.number().default(2000),
  WEBHOOK_TIMEOUT_MS: z.coerce.number().default(5000),
  ALLOW_ORIGINS: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default('gpt-4o-mini'),
  OPENAI_TEMPERATURE: z.coerce.number().default(0.1),
  OPENAI_MAX_PAGES: z.coerce.number().default(5),
  OPENAI_TIMEOUT_MS: z.coerce.number().default(180000),
  WASABI_ENDPOINT: z.string().optional(),
  WASABI_REGION: z.string().optional(),
  WASABI_ACCESS_KEY_ID: z.string().optional(),
  WASABI_SECRET_ACCESS_KEY: z.string().optional(),
  WASABI_BUCKET_NAME: z.string().optional(),
  MAX_FILE_SIZE: z.coerce.number().default(104857600),
  SUPPORTED_MIME_TYPES: z
    .string()
    .default('application/pdf,image/vnd.dwg,application/vnd.dwg,model/vnd.ifc'),
  RATE_LIMIT_TTL: z.coerce.number().default(60),
  RATE_LIMIT_MAX: z.coerce.number().default(100),
  REDIS_URL: z.string().optional(),
  REDIS_HOST: z.string().optional(),
  REDIS_PORT: z.coerce.number().optional(),
  REDIS_PASSWORD: z.string().optional(),
});

const raw = envSchema.parse(process.env);

export const config = {
  nodeEnv: raw.NODE_ENV,
  port: raw.PORT,
  apiPrefix: raw.API_PREFIX,
  mongoUri: raw.MONGODB_URI,
  jwtSecret: raw.JWT_SECRET,
  jwtExpiresIn: raw.JWT_EXPIRES_IN,
  defaultClient: {
    id: raw.DEFAULT_CLIENT_ID,
    secret: raw.DEFAULT_CLIENT_SECRET,
    name: raw.DEFAULT_CLIENT_NAME,
  },
  storageDir: raw.STORAGE_DIR,
  jobProcessingDelayMs: raw.JOB_PROCESSING_DELAY_MS,
  webhookTimeoutMs: raw.WEBHOOK_TIMEOUT_MS,
  allowedOrigins:
    raw.ALLOW_ORIGINS?.split(',').map((origin) => origin.trim()).filter(Boolean) ??
    ['*'],
  openAiApiKey: raw.OPENAI_API_KEY,
  openAiModel: raw.OPENAI_MODEL,
  openAiTemperature: raw.OPENAI_TEMPERATURE,
  openAiMaxPages: raw.OPENAI_MAX_PAGES,
  openAiTimeoutMs: raw.OPENAI_TIMEOUT_MS,
  wasabi: raw.WASABI_BUCKET_NAME
    ? {
        endpoint: raw.WASABI_ENDPOINT ?? 'https://s3.wasabisys.com',
        region: raw.WASABI_REGION ?? 'us-east-1',
        accessKeyId: raw.WASABI_ACCESS_KEY_ID!,
        secretAccessKey: raw.WASABI_SECRET_ACCESS_KEY!,
        bucket: raw.WASABI_BUCKET_NAME!,
      }
    : undefined,
  maxFileSizeBytes: raw.MAX_FILE_SIZE,
  supportedMimeTypes: raw.SUPPORTED_MIME_TYPES.split(',').map((type) => type.trim()),
  rateLimit: {
    ttlSeconds: raw.RATE_LIMIT_TTL,
    maxRequests: raw.RATE_LIMIT_MAX,
  },
  redis: raw.REDIS_URL
    ? { url: raw.REDIS_URL }
    : raw.REDIS_HOST
    ? {
        host: raw.REDIS_HOST,
        port: raw.REDIS_PORT ?? 6379,
        password: raw.REDIS_PASSWORD,
      }
    : undefined,
};

