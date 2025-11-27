import { Request, Response } from 'express';
import { z } from 'zod';
import { validateClientCredentials } from '../services/client.service';
import { signAccessToken } from '../services/token.service';
import { HttpError } from '../utils/http-error';

const tokenSchema = z.object({
  grant_type: z.literal('client_credentials'),
  client_id: z.string().min(3),
  client_secret: z.string().min(6),
});

export const issueToken = async (req: Request, res: Response) => {
  const body = tokenSchema.parse(req.body);
  const client = await validateClientCredentials(
    body.client_id,
    body.client_secret,
  );

  if (!client) {
    throw new HttpError(401, 'Invalid client credentials');
  }

  const accessToken = signAccessToken({
    clientId: client.clientId,
    scopes: client.scopes,
  });

  res.json({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: 3600,
  });
};

