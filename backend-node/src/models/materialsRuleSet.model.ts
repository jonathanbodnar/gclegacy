import { Schema, model, Document } from 'mongoose';
import { RuleSet } from '../types/rules';

export interface MaterialsRuleSetDocument extends Document {
  name: string;
  version: string;
  rules: RuleSet;
  createdAt: Date;
  updatedAt: Date;
}

const MaterialsRuleSetSchema = new Schema<MaterialsRuleSetDocument>(
  {
    name: { type: String, required: true },
    version: { type: String, required: true },
    rules: { type: Schema.Types.Mixed, required: true },
  },
  {
    timestamps: true,
  },
);

MaterialsRuleSetSchema.index({ name: 1, version: 1 }, { unique: true });

export const MaterialsRuleSetModel = model<MaterialsRuleSetDocument>(
  'MaterialsRuleSet',
  MaterialsRuleSetSchema,
);


