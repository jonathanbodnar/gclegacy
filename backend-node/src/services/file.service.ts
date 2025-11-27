import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import pdfParse from 'pdf-parse';
import { FileDocument, FileModel } from '../models/file.model';

interface CreateFileInput {
  projectId?: string;
  originalName: string;
  storagePath: string;
  size: number;
  mimeType: string;
  uploadedBy: string;
  metadata?: Record<string, unknown>;
  tags?: string[];
}

const resolveStorageKey = (absolutePath: string): string => {
  const normalized = absolutePath.replace(/\\/g, '/');
  const storageIdx = normalized.lastIndexOf('/storage/');
  if (storageIdx >= 0) {
    return normalized.slice(storageIdx + 1); // include storage/ prefix for uniqueness
  }
  return path.basename(normalized);
};

export const createFile = async (input: CreateFileInput): Promise<FileDocument> => {
  const buffer = await fs.readFile(input.storagePath);
  const checksum = crypto.createHash('sha256').update(buffer).digest('hex');

  const existing = await FileModel.findOne({ checksum });
  if (existing) {
    await fs.unlink(input.storagePath).catch(() => undefined);
    return existing;
  }

  let pages: number | undefined;
  if (input.mimeType === 'application/pdf') {
    try {
      const pdfData = await pdfParse(buffer);
      pages = pdfData.numpages;
    } catch {
      pages = undefined;
    }
  }

  const storageKey = resolveStorageKey(path.resolve(input.storagePath));

  const file = await FileModel.create({
    projectId: input.projectId,
    originalName: input.originalName,
    storagePath: input.storagePath,
    storageKey,
    storageUrl: input.storagePath,
    size: input.size,
    mimeType: input.mimeType,
    uploadedBy: input.uploadedBy,
    metadata: input.metadata,
    tags: input.tags ?? [],
    pages,
    checksum,
  });

  return file;
};

export const findFileById = async (id: string): Promise<FileDocument | null> =>
  FileModel.findById(id);

export const getFileBuffer = async (file: FileDocument): Promise<Buffer> =>
  fs.readFile(file.storagePath);

export const deleteFile = async (fileId: string): Promise<void> => {
  const file = await FileModel.findById(fileId);
  if (!file) {
    return;
  }

  await fs.unlink(file.storagePath).catch(() => undefined);
  await file.deleteOne();
};

