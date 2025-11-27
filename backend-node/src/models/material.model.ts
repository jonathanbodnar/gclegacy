import { Schema, model, Document, Types } from 'mongoose';

export interface MaterialDocument extends Document {
  job: Types.ObjectId;
  sku: string;
  qty: number;
  uom: string;
  description?: string;
  category?: string;
  ruleId?: string;
  sources?: {
    features?: Types.ObjectId[] | string[];
    notes?: string;
  };
  pricing?: {
    unitPrice?: number;
    totalPrice?: number;
    currency?: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

const MaterialSchema = new Schema<MaterialDocument>(
  {
    job: { type: Schema.Types.ObjectId, ref: 'Job', required: true, index: true },
    sku: { type: String, required: true },
    qty: { type: Number, required: true },
    uom: { type: String, required: true },
    description: { type: String },
    category: { type: String },
    ruleId: { type: String },
    sources: { type: Schema.Types.Mixed },
    pricing: {
      unitPrice: { type: Number },
      totalPrice: { type: Number },
      currency: { type: String, default: 'USD' },
    },
  },
  {
    timestamps: true,
  },
);

MaterialSchema.index({ job: 1, sku: 1 });

export const MaterialModel = model<MaterialDocument>('Material', MaterialSchema);

