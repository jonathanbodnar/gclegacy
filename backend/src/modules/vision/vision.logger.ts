import { promises as fs } from 'fs';
import * as path from 'path';

const LOG_DIR = path.join(process.cwd(), 'logs');
const LOG_FILE = path.join(LOG_DIR, 'vision.log');

async function ensureLogDir(): Promise<void> {
  try {
    await fs.mkdir(LOG_DIR, { recursive: true });
  } catch {
    // ignore mkdir race
  }
}

export async function appendVisionLog(message: string, data?: any): Promise<void> {
  try {
    await ensureLogDir();
    const timestamp = new Date().toISOString();
    const payload = data !== undefined ? ` ${JSON.stringify(data, null, 2)}` : '';
    await fs.appendFile(LOG_FILE, `[${timestamp}] ${message}${payload}\n`);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('Failed to write vision log:', error.message);
  }
}
