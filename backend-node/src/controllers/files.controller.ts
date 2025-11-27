import { Request, Response } from 'express';
import { z } from 'zod';
import { createFile } from '../services/file.service';
import { HttpError } from '../utils/http-error';

const fileBodySchema = z.object({
  projectId: z.string().min(1).optional(),
  filename: z.string().min(1).optional(),
  tags: z
    .union([z.array(z.string()), z.string()])
    .optional()
    .transform((value) => {
      if (!value) return [];
      if (Array.isArray(value)) return value;
      return value
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean);
    }),
  metadata: z
    .union([z.string(), z.record(z.string(), z.any())])
    .optional()
    .transform((value) => {
      if (!value) return undefined;
      if (typeof value === 'string') {
        try {
          return JSON.parse(value);
        } catch {
          return undefined;
        }
      }
      return value;
    }),
});

export const uploadPlanFile = async (req: Request, res: Response) => {
  if (!req.client) {
    throw new HttpError(401, 'Unauthorized');
  }

  if (!req.file) {
    throw new HttpError(400, 'File is required');
  }

  const payload = fileBodySchema.parse(req.body);

  const storedFile = await createFile({
    projectId: payload.projectId,
    originalName: payload.filename ?? req.file.originalname,
    storagePath: req.file.path,
    size: req.file.size,
    mimeType: req.file.mimetype,
    uploadedBy: req.client._id.toString(),
    metadata: payload.metadata,
    tags: payload.tags,
  });

  res.status(201).json({
    fileId: storedFile._id.toString(),
    id: storedFile._id.toString(),
    projectId: storedFile.projectId,
    filename: storedFile.originalName,
    pages: storedFile.pages,
    mime: storedFile.mimeType,
    checksum: storedFile.checksum,
    status: storedFile.status,
    uploadedAt: storedFile.createdAt,
    storageKey: storedFile.storageKey,
  });
};

