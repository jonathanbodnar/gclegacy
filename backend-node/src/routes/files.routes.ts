import { Router } from 'express';
import { uploadPlanFile } from '../controllers/files.controller';
import { authenticateClient } from '../middleware/authenticate-client';
import { upload } from '../middleware/upload';

const router = Router();

router.post(
  '/',
  authenticateClient,
  upload.single('file'),
  uploadPlanFile,
);

export default router;

