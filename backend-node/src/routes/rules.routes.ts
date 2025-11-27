import { Router } from 'express';
import { createRuleSet } from '../controllers/rules.controller';
import { authenticateClient } from '../middleware/authenticate-client';

const router = Router();

router.post('/rulesets', authenticateClient, createRuleSet);

export default router;


