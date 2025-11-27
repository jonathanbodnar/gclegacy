import { Router } from 'express';
import { issueToken } from '../controllers/auth.controller';

const router = Router();

router.post('/token', issueToken);

export default router;

