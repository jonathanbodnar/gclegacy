import { Router } from 'express';
import authRoutes from './auth.routes';
import fileRoutes from './files.routes';
import jobRoutes from './jobs.routes';
import resultsRoutes from './results.routes';
import webhookRoutes from './webhooks.routes';
import healthRoutes from './health.routes';
import rulesRoutes from './rules.routes';

const router = Router();

router.use('/oauth', authRoutes);
router.use('/files', fileRoutes);
router.use('/jobs', jobRoutes);
router.use('/', resultsRoutes);
router.use('/webhooks', webhookRoutes);
router.use('/rules', rulesRoutes);
router.use('/', healthRoutes);

export default router;

