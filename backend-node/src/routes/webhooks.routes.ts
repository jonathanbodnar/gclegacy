import { Router } from 'express';
import { triggerTestWebhook } from '../controllers/webhooks.controller';
import { authenticateClient } from '../middleware/authenticate-client';

const router = Router();

router.post('/test', authenticateClient, triggerTestWebhook);

export default router;

