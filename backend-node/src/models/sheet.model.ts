import { Schema, model, Document, Types } from 'mongoose';

export interface SheetDocument extends Document {
  job: Types.ObjectId;
  index: number;
  name?: string;
  discipline?: string;
  scale?: string;
  units?: string;
  scaleRatio?: number;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const SheetSchema = new Schema<SheetDocument>(
  {
    job: { type: Schema.Types.ObjectId, ref: 'Job', required: true, index: true },
    index: { type: Number, required: true },
    name: { type: String },
    discipline: { type: String },
    scale: { type: String },
    units: { type: String },
    scaleRatio: { type: Number },
    metadata: { type: Schema.Types.Mixed },
  },
  {
    timestamps: true,
  },
);

SheetSchema.index({ job: 1, index: 1 }, { unique: true });

export const SheetModel = model<SheetDocument>('Sheet', SheetSchema);

