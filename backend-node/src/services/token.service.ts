import jwt, { type SignOptions } from 'jsonwebtoken';
import type ms from 'ms';
import { config } from '../config/env';
import { findClientById } from './client.service';

interface AccessTokenPayload {
  clientId: string;
  scopes: string[];
}

const signOptions: SignOptions = {
  expiresIn: config.jwtExpiresIn as ms.StringValue,
};

export const signAccessToken = (payload: AccessTokenPayload): string =>
  jwt.sign(payload, config.jwtSecret, signOptions);

export const verifyAccessToken = async (
  token: string,
): Promise<AccessTokenPayload | null> => {
  try {
    const decoded = jwt.verify(token, config.jwtSecret) as AccessTokenPayload;
    const client = await findClientById(decoded.clientId);
    if (!client) {
      return null;
    }
    return decoded;
  } catch (error) {
    return null;
  }
};

