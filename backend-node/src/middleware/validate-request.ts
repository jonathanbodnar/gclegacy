import { NextFunction, Request, Response } from 'express';
import { ZodError, ZodTypeAny } from 'zod';
import { HttpError } from '../utils/http-error';

export const validateRequest =
  (schema: ZodTypeAny) =>
  (req: Request, _res: Response, next: NextFunction) => {
    try {
      schema.parse({
        body: req.body,
        params: req.params,
        query: req.query,
      });
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        next(new HttpError(400, 'Validation failed', error.flatten()));
        return;
      }
      next(error);
    }
  };

