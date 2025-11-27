import { NextFunction, Request, Response } from 'express';
import { verifyAccessToken } from '../services/token.service';
import { findClientById } from '../services/client.service';
import { HttpError } from '../utils/http-error';

export const authenticateClient = async (
  req: Request,
  _res: Response,
  next: NextFunction,
) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    next(new HttpError(401, 'Missing Authorization header'));
    return;
  }

  const token = authHeader.replace('Bearer ', '').trim();
  const decoded = await verifyAccessToken(token);
  if (!decoded) {
    next(new HttpError(401, 'Invalid or expired token'));
    return;
  }

  const client = await findClientById(decoded.clientId);
  if (!client) {
    next(new HttpError(401, 'Client not found'));
    return;
  }

  req.client = client;
  next();
};

