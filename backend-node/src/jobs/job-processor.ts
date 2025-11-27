import fs from 'fs/promises';
import { Types } from 'mongoose';
import { JobModel, JobDocument } from '../models/job.model';
import { SheetDocument } from '../models/sheet.model';
import { FeatureDocument } from '../models/feature.model';
import { sleep } from '../utils/time';
import { logger } from '../utils/logger';
import { sendJobUpdateWebhook } from '../services/webhook.service';
import { updateJobStatus, updateJobMetadata, clearJobData, listQueuedJobs } from '../services/job.service';
import { OpenAIPlanService } from '../services/openai-plan.service';
import { FeatureExtractionService } from '../services/feature-extraction.service';
import { rulesEngineService } from '../services/rules-engine.service';
type PopulatedJob = JobDocument & { file: any };

class JobProcessor {
  private queue: string[] = [];
  private processing = false;
  private openAiPlanService = new OpenAIPlanService();
  private featureExtractionService = new FeatureExtractionService();

  enqueue(jobId: string) {
    if (this.queue.includes(jobId)) {
      return;
    }
    this.queue.push(jobId);
    void this.runQueue();
  }

  remove(jobId: string) {
    this.queue = this.queue.filter((queuedId) => queuedId !== jobId);
  }

  reset() {
    this.queue = [];
  }

  async processQueuedJobs(): Promise<number> {
    const queuedJobs = await listQueuedJobs();
    queuedJobs.forEach((job) => this.enqueue(job._id.toString()));
    return queuedJobs.length;
  }

  private async runQueue(): Promise<void> {
    if (this.processing) {
      return;
    }

    const jobId = this.queue.shift();
    if (!jobId) {
      return;
    }

    this.processing = true;
    try {
      await this.handleJob(jobId);
    } catch (error) {
      logger.error('Job processor failed', error);
    } finally {
      this.processing = false;
      if (this.queue.length > 0) {
        void this.runQueue();
      }
    }
  }

  private async handleJob(jobId: string): Promise<void> {
    const job = (await JobModel.findById(jobId).populate('file')) as PopulatedJob | null;
    if (!job) {
      logger.warn(`Job ${jobId} not found in queue`);
      return;
    }

    if (job.status === 'CANCELLED') {
      logger.info(`Skipping cancelled job ${jobId}`);
      return;
    }

    await clearJobData(jobId);
    await updateJobStatus(jobId, 'PROCESSING', {
      progress: 5,
      message: 'Job ingestion started',
    });
    await this.emitWebhook(jobId, 'job.processing');

    try {
      if (!this.openAiPlanService.isEnabled()) {
        throw new Error(
          'OpenAI analysis is not configured. Set OPENAI_API_KEY and OPENAI_MODEL to enable processing.',
        );
      }

      const localFilePath = job.file.storagePath;
      const fileBuffer = await fs.readFile(localFilePath);

      const pipelineResult = await this.processWithOpenAI(job, fileBuffer);
      await updateJobStatus(jobId, 'PROCESSING', {
        progress: 65,
        message: 'OpenAI analysis completed',
      });

      await sleep(250);
      const ruleSetId = job.materialsRuleSetId?.toString();
      if (!ruleSetId) {
        throw new Error('Job is missing materialsRuleSetId');
      }
      const materialsCount = await rulesEngineService.applyRules(
        job._id.toString(),
        ruleSetId,
        pipelineResult.features,
      );
      await updateJobStatus(jobId, 'PROCESSING', {
        progress: 90,
        message: 'Materials generated',
      });

      const artifacts = this.buildArtifacts(jobId, pipelineResult.sheets);
      const costIntelligence = this.buildCostIntelligence(
        pipelineResult.features,
        materialsCount,
      );
      const laborModel = this.buildLaborModel(pipelineResult.features);

      await updateJobMetadata(jobId, {
        artifacts,
        takeoffSnapshot: {
          features: pipelineResult.features.length,
          materials: materialsCount,
          targets: pipelineResult.targetSummary,
        },
        costIntelligence,
        laborModel,
      });

      await updateJobStatus(jobId, 'COMPLETED', {
        progress: 100,
        message: 'Job completed successfully',
      });
      await sleep(250);
      await this.emitWebhook(jobId, 'job.completed');
    } catch (error) {
      logger.error(`Job ${jobId} failed`, error);
      await updateJobStatus(jobId, 'FAILED', {
        progress: 100,
        message: (error as Error).message,
        error: (error as Error).message,
      });
      await this.emitWebhook(jobId, 'job.failed');
    }
  }

  private async processWithOpenAI(
    job: PopulatedJob,
    fileBuffer: Buffer,
  ): Promise<{
    sheets: SheetDocument[];
    features: FeatureDocument[];
    targetSummary: Record<string, number>;
  }> {
    const analysis = await this.openAiPlanService.analyze(
      fileBuffer,
      job.file.originalName,
      job.disciplines,
      job.targets,
    );
    const { sheets, features } = await this.featureExtractionService.persist(
      job,
      analysis.pages,
    );

    const targetSummary = this.summarizeFeatures(features);
    return { sheets, features, targetSummary };
  }

  private summarizeFeatures(features: FeatureDocument[]) {
    return features.reduce<Record<string, number>>((acc, feature) => {
      switch (feature.type) {
        case 'ROOM':
          acc.rooms = (acc.rooms || 0) + 1;
          break;
        case 'WALL':
          acc.walls = (acc.walls || 0) + 1;
          break;
        case 'OPENING':
          acc.openings = (acc.openings || 0) + 1;
          break;
        case 'PIPE':
          acc.pipes = (acc.pipes || 0) + 1;
          break;
        case 'DUCT':
          acc.ducts = (acc.ducts || 0) + 1;
          break;
        case 'FIXTURE':
          acc.fixtures = (acc.fixtures || 0) + 1;
          break;
        default:
          acc.other = (acc.other || 0) + 1;
      }
      return acc;
    }, {});
  }

  private buildArtifacts(jobId: string, sheets: SheetDocument[]) {
    return sheets.slice(0, 3).map((sheet) => ({
      label: `${sheet.name ?? `Sheet ${sheet.index + 1}`} overlay`,
      kind: 'overlay' as const,
      url: `https://storage.local/jobs/${jobId}/sheet-${sheet.index + 1}.png`,
    }));
  }

  private buildCostIntelligence(features: FeatureDocument[], materials: number) {
    const estimatedCost =
      materials * 500 + features.filter((f) => f.type === 'WALL').reduce((sum, feature) => sum + (feature.length ?? 0), 0) * 25;

    return {
      estimatedCost,
      currency: 'USD',
      breakdown: {
        structural: estimatedCost * 0.4,
        mechanical: estimatedCost * 0.35,
        electrical: estimatedCost * 0.25,
      },
    };
  }

  private buildLaborModel(features: FeatureDocument[]) {
    const wallCount = features.filter((feature) => feature.type === 'WALL').length;
    const crewHours = wallCount * 8 + features.length * 1.5;

    return {
      crews: [
        { trade: 'Framing', hours: wallCount * 4 },
        { trade: 'MEP', hours: features.filter((f) => f.type === 'PIPE' || f.type === 'DUCT').length * 3 },
      ],
      totalHours: crewHours,
    };
  }

  private async emitWebhook(jobId: string, event: 'job.processing' | 'job.completed' | 'job.failed') {
    const job = await JobModel.findById(jobId);
    if (job) {
      await sendJobUpdateWebhook(job, event);
    }
  }
}

export const jobProcessor = new JobProcessor();

