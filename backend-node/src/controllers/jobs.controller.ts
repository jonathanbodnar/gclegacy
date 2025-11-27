import { Request, Response } from 'express';
import { z } from 'zod';
import {
  createJob,
  findJobById,
  updateJobStatus,
  deleteJobsByStatus,
  clearJobData,
} from '../services/job.service';
import { findFileById } from '../services/file.service';
import { HttpError } from '../utils/http-error';
import { jobProcessor } from '../jobs/job-processor';
import { toObjectIdString } from '../utils/object-id';
import { rulesEngineService } from '../services/rules-engine.service';

const allowedDisciplines = ['A', 'P', 'M', 'E'] as const;
const allowedTargets = [
  'rooms',
  'walls',
  'doors',
  'windows',
  'pipes',
  'ducts',
  'fixtures',
  'elevations',
  'sections',
  'risers',
  'levels',
] as const;

const jobSchema = z.object({
  fileId: z.string().min(1),
  disciplines: z
    .array(z.enum(allowedDisciplines))
    .min(1, 'At least one discipline is required'),
  targets: z
    .array(z.enum(allowedTargets))
    .min(1, 'At least one target is required'),
  materialsRuleSetId: z.string().optional(),
  options: z.record(z.string(), z.any()).optional(),
  webhookUrl: z.string().url().optional(),
});

export const createAnalysisJob = async (req: Request, res: Response) => {
  if (!req.client) {
    throw new HttpError(401, 'Unauthorized');
  }

  const payload = jobSchema.parse(req.body);
  const file = await findFileById(payload.fileId);
  if (!file) {
    throw new HttpError(404, 'File not found');
  }

  if (file.uploadedBy.toString() !== req.client._id.toString()) {
    throw new HttpError(403, 'File does not belong to your client');
  }

  let materialsRuleSetId = payload.materialsRuleSetId;
  if (materialsRuleSetId) {
    await rulesEngineService.getRuleSetById(materialsRuleSetId);
  } else {
    const defaultRuleSet = await rulesEngineService.getDefaultRuleSet();
    if (!defaultRuleSet) {
      throw new HttpError(400, 'No default materials rule set configured');
    }
    materialsRuleSetId = defaultRuleSet._id.toString();
  }

  const job = await createJob({
    clientId: req.client._id,
    fileId: file._id,
    disciplines: payload.disciplines,
    targets: payload.targets,
    materialsRuleSetId,
    options: payload.options,
    webhookUrl: payload.webhookUrl,
  });

  jobProcessor.enqueue(job._id.toString());

  const jobId = job._id.toString();

  res.status(202).json({
    jobId,
    id: jobId,
    status: job.status,
    createdAt: job.createdAt,
    targets: job.targets,
  });
};

export const getJob = async (req: Request, res: Response) => {
  if (!req.client) {
    throw new HttpError(401, 'Unauthorized');
  }

  const job = await findJobById(req.params.jobId);
  if (!job) {
    throw new HttpError(404, 'Job not found');
  }

  const jobClientId = toObjectIdString(job.client);
  const currentClientId = req.client._id.toString();

  if (jobClientId !== currentClientId) {
    throw new HttpError(403, 'Job does not belong to your client');
  }

  const jobId = job._id.toString();
  const fileId = toObjectIdString(job.file);

  res.json({
    jobId,
    id: jobId,
    status: job.status,
    history: job.history,
    targets: job.targets,
    disciplines: job.disciplines,
    fileId,
    webhookUrl: job.webhookUrl,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    progress: job.progress,
    error: job.error,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
  });
};

export const cancelJob = async (req: Request, res: Response) => {
  if (!req.client) {
    throw new HttpError(401, 'Unauthorized');
  }

  const job = await findJobById(req.params.jobId);
  if (!job) {
    throw new HttpError(404, 'Job not found');
  }

  if (toObjectIdString(job.client) !== req.client._id.toString()) {
    throw new HttpError(403, 'Job does not belong to your client');
  }

  if (job.status === 'COMPLETED' || job.status === 'FAILED') {
    throw new HttpError(400, 'Cannot cancel completed or failed job');
  }

  await updateJobStatus(job._id.toString(), 'CANCELLED', { message: 'Cancelled by API client' });
  jobProcessor.remove(job._id.toString());
  await clearJobData(job._id.toString());

  res.status(204).send();
};

export const clearJobs = async (_req: Request, res: Response) => {
  jobProcessor.reset();
  const deleted = await deleteJobsByStatus(['QUEUED', 'PROCESSING']);
  res.json({
    message: 'Cleared queued and processing jobs',
    jobsDeleted: deleted,
  });
};

export const processQueuedJobs = async (_req: Request, res: Response) => {
  const queued = await jobProcessor.processQueuedJobs();
  res.json({
    message: 'Queued jobs scheduled for processing',
    jobsProcessed: queued,
  });
};

