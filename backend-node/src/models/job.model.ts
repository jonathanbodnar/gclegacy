import { Schema, model, Document, Types } from 'mongoose';
import { ArtifactItem, JobHistoryEntry, JobStatus, TakeoffSummary } from '../types/job';

export interface JobDocument extends Document {
  client: Types.ObjectId;
  file: Types.ObjectId;
  status: JobStatus;
  disciplines: string[];
  targets: string[];
  materialsRuleSetId?: string;
  options?: Record<string, unknown>;
  webhookUrl?: string;
  progress: number;
  error?: string;
  startedAt?: Date;
  finishedAt?: Date;
  history: JobHistoryEntry[];
  takeoffSnapshot?: TakeoffSummary;
  artifacts: ArtifactItem[];
  costIntelligence?: Record<string, unknown>;
  laborModel?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const jobStatusEnum: JobStatus[] = ['QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED'];

const JobSchema = new Schema<JobDocument>(
  {
    client: { type: Schema.Types.ObjectId, ref: 'IntegrationClient', required: true },
    file: { type: Schema.Types.ObjectId, ref: 'File', required: true },
    status: {
      type: String,
      enum: jobStatusEnum,
      default: 'QUEUED',
    },
    disciplines: { type: [String], default: [] },
    targets: { type: [String], default: [] },
    materialsRuleSetId: { type: String },
    options: { type: Schema.Types.Mixed },
    webhookUrl: { type: String },
    progress: { type: Number, default: 0 },
    error: { type: String },
    startedAt: { type: Date },
    finishedAt: { type: Date },
    history: {
      type: [
        {
          status: {
            type: String,
            enum: jobStatusEnum,
            required: true,
          },
          timestamp: { type: Date, required: true },
          message: { type: String },
        },
      ],
      default: [],
    },
    takeoffSnapshot: {
      type: {
        features: Number,
        materials: Number,
        targets: Schema.Types.Mixed,
      },
    },
    costIntelligence: { type: Schema.Types.Mixed },
    laborModel: { type: Schema.Types.Mixed },
    artifacts: {
      type: [
        {
          label: String,
          kind: {
            type: String,
            enum: ['overlay', 'vector', 'report', 'log'],
            default: 'overlay',
          },
          url: String,
        },
      ],
      default: [],
    },
  },
  { timestamps: true },
);

export const JobModel = model<JobDocument>('Job', JobSchema);

