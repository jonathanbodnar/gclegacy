import { Schema, model, Document, Types } from 'mongoose';

export interface FileDocument extends Document {
  projectId?: string;
  originalName: string;
  storagePath: string;
  storageKey: string;
  storageUrl?: string;
  size: number;
  mimeType: string;
  status: 'READY' | 'PROCESSING' | 'FAILED';
  uploadedBy: Types.ObjectId;
  metadata?: Record<string, unknown>;
  tags: string[];
  pages?: number;
  checksum: string;
  createdAt: Date;
  updatedAt: Date;
}

const FileSchema = new Schema<FileDocument>(
  {
    projectId: { type: String },
    originalName: { type: String, required: true },
    storagePath: { type: String, required: true },
    storageKey: { type: String, required: true },
    storageUrl: { type: String },
    size: { type: Number, required: true },
    mimeType: { type: String, required: true },
    pages: { type: Number },
    checksum: { type: String, required: true, unique: true },
    tags: { type: [String], default: [] },
    status: {
      type: String,
      enum: ['READY', 'PROCESSING', 'FAILED'],
      default: 'READY',
    },
    metadata: { type: Schema.Types.Mixed },
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'IntegrationClient', required: true },
  },
  { timestamps: true },
);

export const FileModel = model<FileDocument>('File', FileSchema);

