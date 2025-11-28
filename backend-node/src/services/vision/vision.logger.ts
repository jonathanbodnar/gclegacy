import { promises as fs } from 'fs';
import path from 'path';

const LOG_DIR = path.join(process.cwd(), 'logs');
const LOG_FILE = path.join(LOG_DIR, 'vision.log');

const isProduction = process.env.NODE_ENV === 'production';

const shouldLogToFile =
  process.env.ENABLE_VISION_FILE_LOGGING === 'true' || !isProduction;

const ensureLogDir = async () => {
  if (!shouldLogToFile) {
    return;
  }
  try {
    await fs.mkdir(LOG_DIR, { recursive: true });
  } catch {
    // ignore mkdir race
  }
};

export async function appendVisionLog(message: string, data?: unknown) {
  if (!shouldLogToFile) {
    return;
  }

  await ensureLogDir();
  const timestamp = new Date().toISOString();
  const payload = data !== undefined ? ` ${JSON.stringify(data, null, 2)}` : '';
  try {
    await fs.appendFile(LOG_FILE, `[${timestamp}] ${message}${payload}\n`);
  } catch (error) {
    if (!isProduction) {
      console.warn('Failed to write vision log', (error as Error).message);
    }
  }
}

