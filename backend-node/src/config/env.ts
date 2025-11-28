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
  OPENAI_SHEET_CLASSIFIER_MODEL: z.string().optional(),
  OPENAI_SCALE_MODEL: z.string().optional(),
  OPENAI_SPACE_MODEL: z.string().optional(),
  OPENAI_MATERIALS_MODEL: z.string().optional(),
  OPENAI_ROOM_SCHEDULE_MODEL: z.string().optional(),
  OPENAI_ROOM_SPATIAL_MODEL: z.string().optional(),
  OPENAI_TAKEOFF_MODEL: z.string().optional(),
  OPENAI_PARTITION_MODEL: z.string().optional(),
  OPENAI_WALL_MODEL: z.string().optional(),
  OPENAI_CEILING_MODEL: z.string().optional(),
  OPENAI_TEMPERATURE: z.coerce.number().default(0.1),
  OPENAI_MAX_PAGES: z.coerce.number().default(5),
  OPENAI_TIMEOUT_MS: z.coerce.number().default(180000),
  OPENAI_MAX_RETRIES: z.coerce.number().default(3),
  OPENAI_RETRY_DELAY_MS: z.coerce.number().default(1000),
  VISION_ALLOW_MOCK: z.string().optional(),
  VISION_BATCH_SIZE: z.coerce.number().default(10),
  PDF_CONVERSION_TIMEOUT_MS: z.coerce.number().default(3600000),
  PDF_CONVERSION_TIMEOUT_MIN: z.coerce.number().optional(),
  PDF_RENDER_DPI: z.coerce.number().default(220),
  PDF_RENDER_MAX_PAGES: z.coerce.number().default(100),
  SHEET_CLASSIFIER_TEXT_LIMIT: z.coerce.number().optional(),
  SCALE_EXTRACTION_TEXT_LIMIT: z.coerce.number().optional(),
  SPACE_TEXT_LIMIT: z.coerce.number().optional(),
  MATERIALS_TEXT_LIMIT: z.coerce.number().optional(),
  ROOM_SCHEDULE_TEXT_LIMIT: z.coerce.number().optional(),
  ROOM_SPATIAL_SCHEDULE_LIMIT: z.coerce.number().optional(),
  PARTITION_TEXT_LIMIT: z.coerce.number().optional(),
  WALL_PARTITION_CONTEXT_LIMIT: z.coerce.number().optional(),
  CEILING_TEXT_LIMIT: z.coerce.number().optional(),
  CEILING_ROOM_CONTEXT_LIMIT: z.coerce.number().optional(),
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

const STATIC_FRONTEND_ORIGINS = [
  'https://gclegacy-2.onrender.com',
  'https://gclegacy-backend-nodejs.onrender.com',
  'http://localhost:4173',
  'http://localhost:5173',
];

const normalizeOrigin = (origin: string) => {
  const trimmed = origin.trim();
  if (!trimmed || trimmed === '*') {
    return trimmed;
  }
  return trimmed.replace(/\/+$/, '');
};

const buildAllowedOrigins = (rawValue?: string) => {
  if (!rawValue) {
    return STATIC_FRONTEND_ORIGINS;
  }

  const parsed = rawValue
    .split(',')
    .map(normalizeOrigin)
    .filter(Boolean);

  if (parsed.includes('*')) {
    return ['*'];
  }

  const merged = new Set<string>([
    ...parsed,
    ...STATIC_FRONTEND_ORIGINS,
  ]);

  return Array.from(merged);
};

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
  allowedOrigins: buildAllowedOrigins(raw.ALLOW_ORIGINS),
  openAiApiKey: raw.OPENAI_API_KEY,
  openAiModel: raw.OPENAI_MODEL,
  openAiSheetClassifierModel: raw.OPENAI_SHEET_CLASSIFIER_MODEL,
  openAiScaleModel: raw.OPENAI_SCALE_MODEL,
  openAiSpaceModel: raw.OPENAI_SPACE_MODEL,
  openAiMaterialsModel: raw.OPENAI_MATERIALS_MODEL,
  openAiRoomScheduleModel: raw.OPENAI_ROOM_SCHEDULE_MODEL,
  openAiRoomSpatialModel: raw.OPENAI_ROOM_SPATIAL_MODEL,
  openAiTakeoffModel: raw.OPENAI_TAKEOFF_MODEL,
  openAiPartitionModel: raw.OPENAI_PARTITION_MODEL,
  openAiWallModel: raw.OPENAI_WALL_MODEL,
  openAiCeilingModel: raw.OPENAI_CEILING_MODEL,
  openAiTemperature: raw.OPENAI_TEMPERATURE,
  openAiMaxPages: raw.OPENAI_MAX_PAGES,
  openAiTimeoutMs: raw.OPENAI_TIMEOUT_MS,
  openAiMaxRetries: raw.OPENAI_MAX_RETRIES,
  openAiRetryDelayMs: raw.OPENAI_RETRY_DELAY_MS,
  vision: {
    allowMock: (raw.VISION_ALLOW_MOCK || '').toLowerCase() === 'true',
    batchSize: raw.VISION_BATCH_SIZE,
    pdfConversionTimeoutMs:
      raw.PDF_CONVERSION_TIMEOUT_MS ??
      (raw.PDF_CONVERSION_TIMEOUT_MIN
        ? raw.PDF_CONVERSION_TIMEOUT_MIN * 60 * 1000
        : 60 * 60 * 1000),
    pdfRenderDpi: raw.PDF_RENDER_DPI,
    pdfRenderMaxPages: raw.PDF_RENDER_MAX_PAGES || raw.OPENAI_MAX_PAGES,
  },
  sheetClassifierTextLimit: raw.SHEET_CLASSIFIER_TEXT_LIMIT,
  scaleExtractionTextLimit: raw.SCALE_EXTRACTION_TEXT_LIMIT,
  spaceTextLimit: raw.SPACE_TEXT_LIMIT,
  materialsTextLimit: raw.MATERIALS_TEXT_LIMIT,
  roomScheduleTextLimit: raw.ROOM_SCHEDULE_TEXT_LIMIT,
  roomSpatialScheduleLimit: raw.ROOM_SPATIAL_SCHEDULE_LIMIT,
  partitionTextLimit: raw.PARTITION_TEXT_LIMIT,
  wallPartitionContextLimit: raw.WALL_PARTITION_CONTEXT_LIMIT,
  ceilingTextLimit: raw.CEILING_TEXT_LIMIT,
  ceilingRoomContextLimit: raw.CEILING_ROOM_CONTEXT_LIMIT,
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

