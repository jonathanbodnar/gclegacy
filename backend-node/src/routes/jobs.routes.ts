import { Router } from 'express';
import {
  createAnalysisJob,
  getJob,
  cancelJob,
  clearJobs,
  processQueuedJobs,
} from '../controllers/jobs.controller';
import { authenticateClient } from '../middleware/authenticate-client';

const router = Router();

router.post('/', authenticateClient, createAnalysisJob);
router.get('/:jobId', authenticateClient, getJob);
router.delete('/:jobId', authenticateClient, cancelJob);
router.delete('/', authenticateClient, clearJobs);
router.post('/process-queued', authenticateClient, processQueuedJobs);

export default router;

