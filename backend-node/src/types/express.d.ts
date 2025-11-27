import type { IntegrationClientDocument } from '../models/integrationClient.model';

declare global {
  namespace Express {
    interface Request {
      client?: IntegrationClientDocument;
    }
  }
}

export {};

