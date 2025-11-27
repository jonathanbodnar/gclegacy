import bcrypt from 'bcryptjs';
import { config } from '../config/env';
import {
  IntegrationClientDocument,
  IntegrationClientModel,
} from '../models/integrationClient.model';
import { logger } from '../utils/logger';

const SALT_ROUNDS = 10;

export const ensureDefaultClient = async (): Promise<IntegrationClientDocument> => {
  const existing = await IntegrationClientModel.findOne({
    clientId: config.defaultClient.id,
  });

  if (existing) {
    return existing;
  }

  const client = await IntegrationClientModel.create({
    name: config.defaultClient.name,
    clientId: config.defaultClient.id,
    clientSecretHash: await bcrypt.hash(config.defaultClient.secret, SALT_ROUNDS),
    scopes: ['files:write', 'jobs:write', 'jobs:read'],
  });

  logger.info(`Created default integration client (${config.defaultClient.id})`);
  return client;
};

export const validateClientCredentials = async (
  clientId: string,
  clientSecret: string,
): Promise<IntegrationClientDocument | null> => {
  const client = await IntegrationClientModel.findOne({ clientId });
  if (!client) {
    return null;
  }

  const matches = await client.matchesSecret(clientSecret);
  return matches ? client : null;
};

export const findClientById = async (
  clientId: string,
): Promise<IntegrationClientDocument | null> =>
  IntegrationClientModel.findOne({ clientId });

