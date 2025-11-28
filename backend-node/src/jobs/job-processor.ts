import fs from 'fs/promises';
import { Types } from 'mongoose';
import { JobModel, JobDocument } from '../models/job.model';
import { FileDocument } from '../models/file.model';
import { SheetDocument } from '../models/sheet.model';
import { FeatureDocument } from '../models/feature.model';
import { sleep } from '../utils/time';
import { logger } from '../utils/logger';
import { sendJobUpdateWebhook } from '../services/webhook.service';
import {
  updateJobStatus,
  updateJobMetadata,
  clearJobData,
  listQueuedJobs,
  mergeJobOptions,
} from '../services/job.service';
import { OpenAIPlanService, PageFeatureSet } from '../services/openai-plan.service';
import { FeatureExtractionService } from '../services/feature-extraction.service';
import { rulesEngineService } from '../services/rules-engine.service';
import { IngestService } from '../services/ingest/ingest.service';
import { SheetClassificationService } from '../services/vision/sheet-classification.service';
import { ScaleExtractionService } from '../services/vision/scale-extraction.service';
import { SpaceExtractionService } from '../services/vision/space-extraction.service';
import { MaterialsExtractionService } from '../services/vision/materials-extraction.service';
import { RoomScheduleExtractionService } from '../services/vision/room-schedule-extraction.service';
import { RoomSpatialMappingService } from '../services/vision/room-spatial-mapping.service';
import { PartitionTypeExtractionService } from '../services/vision/partition-type-extraction.service';
import { WallRunExtractionService } from '../services/vision/wall-run-extraction.service';
import { CeilingHeightExtractionService } from '../services/vision/ceiling-height-extraction.service';
import { FinalDataFusionService } from '../services/vision/final-data-fusion.service';
import { TakeoffAggregatorService } from '../services/vision/takeoff-aggregator.service';
type PopulatedJob = JobDocument & { file: FileDocument };

class JobProcessor {
  private queue: string[] = [];
  private processing = false;
  private openAiPlanService = new OpenAIPlanService();
  private featureExtractionService = new FeatureExtractionService();
  private ingestService = new IngestService();
  private sheetClassificationService = new SheetClassificationService();
  private scaleExtractionService = new ScaleExtractionService();
  private spaceExtractionService = new SpaceExtractionService();
  private materialsExtractionService = new MaterialsExtractionService();
  private roomScheduleExtractionService = new RoomScheduleExtractionService();
  private roomSpatialMappingService = new RoomSpatialMappingService();
  private partitionTypeExtractionService = new PartitionTypeExtractionService();
  private wallRunExtractionService = new WallRunExtractionService();
  private ceilingHeightExtractionService = new CeilingHeightExtractionService();
  private finalDataFusionService = new FinalDataFusionService();
  private takeoffAggregator = new TakeoffAggregatorService();

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

      const ingestResult = await this.ingestService.ingestFile(
        job,
        fileBuffer,
        job.disciplines,
        job.options as Record<string, unknown> | undefined,
      );

      await mergeJobOptions(jobId, {
        ingestMetadata: ingestResult.metadata,
      });

      const sheetClassifications = await this.sheetClassificationService.classifySheets(
        ingestResult.sheets,
      );
      if (sheetClassifications.length > 0) {
        await mergeJobOptions(jobId, { sheetClassifications });
      }

      const scaleAnnotations = await this.scaleExtractionService.extractScales(
        ingestResult.sheets,
      );
      if (scaleAnnotations.length > 0) {
        await mergeJobOptions(jobId, { scaleAnnotations });
      }

      const spaces = await this.spaceExtractionService.extractSpaces(ingestResult.sheets);
      if (spaces.length > 0) {
        await mergeJobOptions(jobId, { spaces });
      }

      const spaceFinishes = await this.materialsExtractionService.extractFinishes(
        ingestResult.sheets,
      );
      if (spaceFinishes.length > 0) {
        await mergeJobOptions(jobId, { spaceFinishes });
      }

      const roomSchedules = await this.roomScheduleExtractionService.extractRoomSchedules(
        ingestResult.sheets,
      );
      if (roomSchedules.length > 0) {
        await mergeJobOptions(jobId, { roomSchedules });
      }

      const roomSpatialMappings = await this.roomSpatialMappingService.mapRooms(
        roomSchedules,
        ingestResult.sheets,
      );
      if (roomSpatialMappings.length > 0) {
        await mergeJobOptions(jobId, { roomSpatialMappings });
      }

      await updateJobStatus(jobId, 'PROCESSING', {
        progress: 50,
        message: 'Room schedules and spatial mapping completed',
      });

      const partitionTypes = await this.partitionTypeExtractionService.extractPartitionTypes(
        ingestResult.sheets,
      );
      if (partitionTypes.length > 0) {
        await mergeJobOptions(jobId, { partitionTypes });
      }

      const wallRuns = await this.wallRunExtractionService.extractWallRuns(
        ingestResult.sheets,
        partitionTypes,
        spaces,
      );
      if (wallRuns.length > 0) {
        await mergeJobOptions(jobId, { wallRuns });
      }

      const ceilingHeights = await this.ceilingHeightExtractionService.extractHeights(
        ingestResult.sheets,
        roomSpatialMappings,
        spaces,
      );
      if (ceilingHeights.length > 0) {
        await mergeJobOptions(jobId, { ceilingHeights });
      }

      let fusionData: any;
      try {
        fusionData = this.finalDataFusionService.fuse({
          sheets: ingestResult.sheets || [],
          roomSchedules,
          roomSpatialMappings,
          ceilingHeights,
          wallRuns,
          partitionTypes,
          scaleAnnotations,
          spaces,
          spaceFinishes,
        });
        if (fusionData) {
          await mergeJobOptions(jobId, { fusionData });
        }
      } catch (fusionError) {
        logger.warn(
          `Final data fusion failed for job ${jobId}: ${
            fusionError instanceof Error ? fusionError.message : fusionError
          }`,
        );
      }

      await updateJobStatus(jobId, 'PROCESSING', {
        progress: 60,
        message: 'Partition, wall, and ceiling extraction completed',
      });

      const pipelineResult = await this.processWithOpenAI(job, fileBuffer);
      await updateJobStatus(jobId, 'PROCESSING', {
        progress: 75,
        message: 'OpenAI analysis completed',
      });

      await this.generateSchemaTakeoff(
        jobId,
        pipelineResult.analysisPages,
        pipelineResult.targetSummary,
        pipelineResult.features,
        fusionData,
      );

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
    analysisPages: PageFeatureSet[];
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
    return { sheets, features, targetSummary, analysisPages: analysis.pages };
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

  private async generateSchemaTakeoff(
    jobId: string,
    pages: PageFeatureSet[],
    summary: Record<string, number>,
    features: FeatureDocument[],
    fusionData?: any,
  ): Promise<void> {
    if (!this.takeoffAggregator.isEnabled()) {
      return;
    }

    try {
      const transformedPages = this.transformPagesForAggregator(pages);
      const result = await this.takeoffAggregator.aggregate({
        jobId,
        pages: transformedPages,
        summary,
        features,
        fusion: fusionData,
      });
      if (result) {
        await mergeJobOptions(jobId, { takeoff: result });
      }
    } catch (error) {
      logger.warn(
        `Schema takeoff aggregation failed for job ${jobId}: ${
          error instanceof Error ? error.message : error
        }`,
      );
    }
  }

  private transformPagesForAggregator(pages: PageFeatureSet[]) {
    return (pages || []).map((page) => ({
      fileName: page.sheetTitle,
      pageIndex: page.pageIndex,
      discipline: page.discipline,
      scale:
        typeof page.scale === 'object'
          ? page.scale
          : {
              detected: page.scale ?? 'Unknown',
              units: page.units === 'm' ? 'm' : 'ft',
              ratio: undefined,
            },
      metadata: {
        units: page.units,
        notes: page.notes,
      },
      features: {
        rooms: page.rooms,
        walls: page.walls,
        openings: page.openings,
        pipes: page.pipes,
        ducts: page.ducts,
        fixtures: page.fixtures,
      },
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

