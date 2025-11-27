import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { config } from '../config/env';

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    fs.mkdirSync(config.storageDir, { recursive: true });
    cb(null, config.storageDir);
  },
  filename: (_req, file, cb) => {
    const uniqueName = `${Date.now()}-${file.originalname.replace(/\s+/g, '_')}`;
    cb(null, uniqueName);
  },
});

const fallbackExtensions = ['.pdf', '.dwg', '.dxf', '.ifc', '.zip', '.png', '.jpg'];

export const upload = multer({
  storage,
  limits: {
    fileSize: config.maxFileSizeBytes,
  },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const mimeAllowed =
      config.supportedMimeTypes.length === 0 ||
      config.supportedMimeTypes.includes('*') ||
      config.supportedMimeTypes.includes(file.mimetype);
    if (mimeAllowed || fallbackExtensions.includes(ext)) {
      cb(null, true);
    } else {
      cb(
        new Error(
          `Unsupported file type: ${ext} (${file.mimetype}). Allowed: ${config.supportedMimeTypes.join(
            ', ',
          )}`,
        ),
      );
    }
  },
});

