import { Types } from 'mongoose';
import { JobDocument, JobModel } from '../models/job.model';
import { JobStatus } from '../types/job';
import { SheetModel } from '../models/sheet.model';
import { FeatureModel } from '../models/feature.model';
import { MaterialModel } from '../models/material.model';

interface CreateJobInput {
  clientId: Types.ObjectId;
  fileId: Types.ObjectId;
  disciplines: string[];
  targets: string[];
  materialsRuleSetId?: string;
  options?: Record<string, unknown>;
  webhookUrl?: string;
}

export const createJob = async (input: CreateJobInput): Promise<JobDocument> =>
  JobModel.create({
    client: input.clientId,
    file: input.fileId,
    disciplines: input.disciplines,
    targets: input.targets,
    materialsRuleSetId: input.materialsRuleSetId,
    options: input.options,
    webhookUrl: input.webhookUrl,
    status: 'QUEUED',
    history: [
      {
        status: 'QUEUED',
        timestamp: new Date(),
        message: 'Job created and queued',
      },
    ],
  });

export const findJobById = async (jobId: string): Promise<JobDocument | null> =>
  JobModel.findById(jobId).populate('file').populate('client');

export const updateJobStatus = async (
  jobId: string,
  status: JobStatus,
  updates: {
    progress?: number;
    error?: string | null;
    message?: string;
  } = {},
): Promise<JobDocument | null> => {
  const patch: Record<string, unknown> = { status };

  if (typeof updates.progress === 'number') {
    patch.progress = updates.progress;
  }

  if (updates.error !== undefined) {
    patch.error = updates.error;
  }

  if (status === 'PROCESSING') {
    patch.startedAt = new Date();
  }

  if (status === 'COMPLETED' || status === 'FAILED' || status === 'CANCELLED') {
    patch.finishedAt = new Date();
  }

  const job = await JobModel.findByIdAndUpdate(
    jobId,
    {
      $set: patch,
      $push: {
        history: {
          status,
          timestamp: new Date(),
          message: updates.message,
        },
      },
    },
    { new: true },
  );

  return job;
};

export const updateJobMetadata = async (
  jobId: string,
  metadata: Partial<Pick<JobDocument, 'takeoffSnapshot' | 'artifacts' | 'costIntelligence' | 'laborModel'>>,
): Promise<void> => {
  await JobModel.findByIdAndUpdate(jobId, { $set: metadata });
};

export const clearJobData = async (jobId: string): Promise<void> => {
  await Promise.all([
    SheetModel.deleteMany({ job: jobId }),
    FeatureModel.deleteMany({ job: jobId }),
    MaterialModel.deleteMany({ job: jobId }),
  ]);
};

export const deleteJobsByStatus = async (statuses: JobStatus[]): Promise<number> => {
  const jobs = await JobModel.find({ status: { $in: statuses } }).select('_id');
  if (jobs.length === 0) {
    return 0;
  }
  const jobIds = jobs.map((job) => job._id);
  await Promise.all([
    SheetModel.deleteMany({ job: { $in: jobIds } }),
    FeatureModel.deleteMany({ job: { $in: jobIds } }),
    MaterialModel.deleteMany({ job: { $in: jobIds } }),
  ]);
  const result = await JobModel.deleteMany({ _id: { $in: jobIds } });
  return result.deletedCount ?? 0;
};

export const listQueuedJobs = async (): Promise<JobDocument[]> =>
  JobModel.find({ status: 'QUEUED' }).sort({ createdAt: 1 });

export const markJobError = async (jobId: string, error: string): Promise<void> => {
  await JobModel.findByIdAndUpdate(jobId, {
    $set: { error, status: 'FAILED', finishedAt: new Date() },
    $push: {
      history: {
        status: 'FAILED',
        timestamp: new Date(),
        message: error,
      },
    },
  });
};

