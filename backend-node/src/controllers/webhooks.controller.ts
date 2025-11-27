import axios from 'axios';
import { Request, Response } from 'express';
import { z } from 'zod';
import { config } from '../config/env';

const webhookSchema = z.object({
  url: z.string().url(),
  event: z.string().default('job.test'),
  payload: z.record(z.string(), z.any()).default({}),
});

export const triggerTestWebhook = async (req: Request, res: Response) => {
  const body = webhookSchema.parse(req.body);
  const response = await axios.post(
    body.url,
    {
      event: body.event,
      timestamp: new Date().toISOString(),
      data: body.payload,
    },
    { timeout: config.webhookTimeoutMs },
  );

  res.json({
    status: response.status,
    message: 'Webhook delivered',
  });
};

