import bcrypt from 'bcryptjs';
import { Schema, model, Document } from 'mongoose';

export interface IntegrationClientAttrs {
  name: string;
  clientId: string;
  clientSecretHash: string;
  scopes: string[];
  webhookUrl?: string;
}

export interface IntegrationClientDocument
  extends IntegrationClientAttrs,
    Document {
  matchesSecret(secret: string): Promise<boolean>;
}

const IntegrationClientSchema = new Schema<IntegrationClientDocument>(
  {
    name: { type: String, required: true },
    clientId: { type: String, required: true, unique: true },
    clientSecretHash: { type: String, required: true },
    scopes: { type: [String], default: [] },
    webhookUrl: { type: String },
  },
  {
    timestamps: true,
  },
);

IntegrationClientSchema.methods.matchesSecret = function matchesSecret(
  this: IntegrationClientDocument,
  secret: string,
) {
  return bcrypt.compare(secret, this.clientSecretHash);
};

export const IntegrationClientModel = model<IntegrationClientDocument>(
  'IntegrationClient',
  IntegrationClientSchema,
);

