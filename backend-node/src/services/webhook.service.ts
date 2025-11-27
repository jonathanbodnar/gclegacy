import axios from 'axios';
import { config } from '../config/env';
import { JobDocument } from '../models/job.model';
import { logger } from '../utils/logger';

export const sendJobUpdateWebhook = async (
  job: JobDocument,
  event: 'job.created' | 'job.processing' | 'job.completed' | 'job.failed',
) => {
  if (!job.webhookUrl) {
    return;
  }

  try {
    await axios.post(
      job.webhookUrl,
      {
        event,
        jobId: job._id.toString(),
        status: job.status,
        timestamp: new Date().toISOString(),
        data: {
          fileId: job.file,
          results: {
            takeoff: job.takeoffSnapshot,
            artifacts: job.artifacts,
          },
        },
      },
      {
        timeout: config.webhookTimeoutMs,
      },
    );
  } catch (error) {
    logger.warn('Failed to send webhook', {
      error: (error as Error).message,
      webhookUrl: job.webhookUrl,
    });
  }
};

