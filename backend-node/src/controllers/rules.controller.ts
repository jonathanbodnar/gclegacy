import { Request, Response } from 'express';
import { z } from 'zod';
import { rulesEngineService } from '../services/rules-engine.service';
import { HttpError } from '../utils/http-error';

const createRuleSetSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  rules: z.string().min(1),
});

export const createRuleSet = async (req: Request, res: Response) => {
  if (!req.client) {
    throw new HttpError(401, 'Unauthorized');
  }

  const payload = createRuleSetSchema.parse(req.body);
  const ruleSet = await rulesEngineService.createRuleSet(payload);

  res.status(201).json({
    ruleSetId: ruleSet._id.toString(),
    name: ruleSet.name,
    version: ruleSet.version,
  });
};


