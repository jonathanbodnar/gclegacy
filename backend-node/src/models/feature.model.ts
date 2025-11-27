import { Schema, model, Document, Types } from 'mongoose';

const featureTypes = [
  'ROOM',
  'WALL',
  'OPENING',
  'PIPE',
  'DUCT',
  'FIXTURE',
  'EQUIPMENT',
  'ELEVATION',
  'SECTION',
  'RISER',
  'LEVEL',
] as const;

export type FeatureType = (typeof featureTypes)[number];

export interface FeatureDocument extends Document {
  job: Types.ObjectId;
  sheet?: Types.ObjectId;
  type: FeatureType;
  props?: Record<string, unknown>;
  geom?: Record<string, unknown>;
  area?: number;
  length?: number;
  count?: number;
  provenance?: Record<string, unknown>;
  validation?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const FeatureSchema = new Schema<FeatureDocument>(
  {
    job: { type: Schema.Types.ObjectId, ref: 'Job', required: true, index: true },
    sheet: { type: Schema.Types.ObjectId, ref: 'Sheet' },
    type: { type: String, enum: featureTypes, required: true },
    props: { type: Schema.Types.Mixed },
    geom: { type: Schema.Types.Mixed },
    area: { type: Number },
    length: { type: Number },
    count: { type: Number, default: 1 },
    provenance: { type: Schema.Types.Mixed },
    validation: { type: Schema.Types.Mixed },
  },
  {
    timestamps: true,
  },
);

FeatureSchema.index({ job: 1, type: 1 });

export const FeatureModel = model<FeatureDocument>('Feature', FeatureSchema);

