import { Request, Response } from 'express';
import { findJobById } from '../services/job.service';
import { HttpError } from '../utils/http-error';
import { toObjectIdString } from '../utils/object-id';

export const getArtifacts = async (req: Request, res: Response) => {
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

  if (job.status !== 'COMPLETED' || job.artifacts.length === 0) {
    throw new HttpError(409, 'Artifacts not available yet');
  }

  res.json({
    jobId: job._id.toString(),
    artifacts: job.artifacts,
  });
};

