import { Request, Response, NextFunction } from 'express';
import { HttpError } from '../utils/http-error';
import { logger } from '../utils/logger';

export const errorHandler = (
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
) => {
  const status = err instanceof HttpError ? err.statusCode : 500;
  const payload: Record<string, unknown> = {
    message: err.message || 'Internal server error',
  };

  if (err instanceof HttpError && err.details) {
    payload.details = err.details;
  }

  if (status >= 500) {
    logger.error('Unhandled error', err);
  }

  res.status(status).json(payload);
};

