import { Router } from 'express';
import { getTakeoffResults } from '../controllers/takeoff.controller';
import { getMaterials } from '../controllers/materials.controller';
import { getArtifacts } from '../controllers/artifacts.controller';
import { authenticateClient } from '../middleware/authenticate-client';

const router = Router();

router.get('/takeoff/:jobId', authenticateClient, getTakeoffResults);
router.get('/materials/:jobId', authenticateClient, getMaterials);
router.get('/artifacts/:jobId', authenticateClient, getArtifacts);

export default router;

