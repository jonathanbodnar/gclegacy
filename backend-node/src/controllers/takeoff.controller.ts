import { Request, Response } from 'express';
import { findJobById } from '../services/job.service';
import { HttpError } from '../utils/http-error';
import { toObjectIdString } from '../utils/object-id';
import { buildTakeoffResponse } from '../services/takeoff.service';

export const getTakeoffResults = async (req: Request, res: Response) => {
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

  if (job.status !== 'COMPLETED') {
    throw new HttpError(409, 'Takeoff results not available yet');
  }

  const response = await buildTakeoffResponse(job._id.toString());
  res.json(response);
};

