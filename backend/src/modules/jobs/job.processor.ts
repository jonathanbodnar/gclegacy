import { Processor, Process } from '@nestjs/bull';
import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bull';
import { JobStatus } from '@prisma/client';

import { JobsService } from './jobs.service';
import { IngestService } from '../ingest/ingest.service';
import { RulesEngineService } from '../rules-engine/rules-engine.service';
import { PlanAnalysisService } from '../vision/plan-analysis.service';
import { FeatureExtractionService } from '../vision/feature-extraction.service';
import { TakeoffAggregatorService } from '../vision/takeoff-aggregator.service';
import { SheetClassificationService } from '../vision/sheet-classification.service';
import { FilesService } from '../files/files.service';
import { ScopeDiagnosisService } from '../scope-diagnosis/scope-diagnosis.service';
import { CostIntelligenceService } from '../cost-intelligence/cost-intelligence.service';
import { LaborModelingService } from '../cost-intelligence/labor-modeling.service';
import { RoomScheduleExtractionService } from '../vision/room-schedule-extraction.service';
import { RoomSpatialMappingService } from '../vision/room-spatial-mapping.service';
import { PartitionTypeExtractionService } from '../vision/partition-type-extraction.service';
import { WallRunExtractionService } from '../vision/wall-run-extraction.service';
import { CeilingHeightExtractionService } from '../vision/ceiling-height-extraction.service';
import { FinalDataFusionService } from '../vision/final-data-fusion.service';
import { ScaleExtractionService, ScaleAnnotation } from '../vision/scale-extraction.service';
import {
  SpaceExtractionService,
  SpaceDefinition,
  SheetTrustSummary,
} from '../vision/space-extraction.service';
import { MaterialsExtractionService, SpaceFinishDefinition } from '../vision/materials-extraction.service';

interface ProcessJobData {
  jobId: string;
  fileId: string;
  disciplines: string[];
  targets: string[];
  materialsRuleSetId?: string;
  options?: any;
}

@Injectable()
@Processor('job-processing')
export class JobProcessor {
  private readonly logger = new Logger(JobProcessor.name);

  constructor(
    private jobsService: JobsService,
    private ingestService: IngestService,
    private rulesEngineService: RulesEngineService,
    private planAnalysisService: PlanAnalysisService,
    private featureExtractionService: FeatureExtractionService,
    private takeoffAggregator: TakeoffAggregatorService,
    private filesService: FilesService,
    private scopeDiagnosisService: ScopeDiagnosisService,
    private costIntelligenceService: CostIntelligenceService,
    private laborModelingService: LaborModelingService,
    private roomScheduleExtractionService: RoomScheduleExtractionService,
    private roomSpatialMappingService: RoomSpatialMappingService,
    private sheetClassificationService: SheetClassificationService,
    private partitionTypeExtractionService: PartitionTypeExtractionService,
    private wallRunExtractionService: WallRunExtractionService,
    private ceilingHeightExtractionService: CeilingHeightExtractionService,
    private scaleExtractionService: ScaleExtractionService,
    private finalDataFusionService: FinalDataFusionService,
  ) {}

  @Process('process-job')
  async processJob(job: Job<ProcessJobData>) {
    const { jobId, fileId, disciplines, targets, materialsRuleSetId, options } = job.data;
    
    this.logger.log(`Starting job processing: ${jobId}`);

    try {
      // Update job status to processing
      await this.jobsService.updateJobStatus(jobId, JobStatus.PROCESSING, 0);

      // Step 1: Ingest and parse file (20% progress)
      await this.reportProgress(job, 10);
      const ingestResult = await this.ingestService.ingestFile(fileId, disciplines, options);
      await this.reportProgress(job, 20);

      // Stage 1: classify sheets using GPT (know which pages drive which prompts)
      try {
        const sheetClassifications = await this.sheetClassificationService.classifySheets(
          ingestResult.sheets || [],
        );
        await this.jobsService.mergeJobOptions(jobId, {
          sheetClassifications,
        });
      } catch (classificationError) {
        this.logger.warn(
          `Sheet classification failed for job ${jobId}: ${classificationError.message}`,
        );
      }

      // Stage 2: extract generic spaces from plan sheets
      let spaces: SpaceDefinition[] = [];
      let spaceTrustSummaries: SheetTrustSummary[] = [];
      try {
        const spaceResult = await this.spaceExtractionService.extractSpaces(ingestResult.sheets || []);
        spaces = spaceResult.spaces;
        spaceTrustSummaries = spaceResult.sheets;
        if (spaces.length) {
          await this.jobsService.mergeJobOptions(jobId, { spaces });
        }
        if (spaceTrustSummaries.length) {
          await this.jobsService.mergeJobOptions(jobId, { spaceTrustSummaries });
        }
        const lowTrustSheets = spaceTrustSummaries.filter((summary) => summary.trustScore < 0.6);
        if (lowTrustSheets.length) {
          this.logger.warn(
            `Job ${jobId} flagged for manual review: ${lowTrustSheets.length} sheet(s) scored below trust threshold`,
          );
          await this.jobsService.mergeJobOptions(jobId, {
            lowTrustSheets,
          });
        }
      } catch (spaceError) {
        this.logger.warn(
          `Space extraction failed for job ${jobId}: ${spaceError.message}`,
        );
      }

      // Stage 2B: finishes/materials extraction for materials sheets
      let spaceFinishes: SpaceFinishDefinition[] = [];
      try {
        spaceFinishes = await this.materialsExtractionService.extractFinishes(
          ingestResult.sheets || [],
        );
        if (spaceFinishes.length) {
          await this.jobsService.mergeJobOptions(jobId, { spaceFinishes });
        }
      } catch (materialsError) {
        this.logger.warn(
          `Materials extraction failed for job ${jobId}: ${materialsError.message}`,
        );
      }

      // Stage 2A: extract room schedules from text
      let roomSchedules: any[] = [];
      try {
        roomSchedules = await this.roomScheduleExtractionService.extractRoomSchedules(
          ingestResult.sheets || [],
        );
        if (roomSchedules.length) {
          await this.jobsService.mergeJobOptions(jobId, { roomSchedules });
        }
      } catch (scheduleError) {
        this.logger.warn(
          `Room schedule extraction failed for job ${jobId}: ${scheduleError.message}`,
        );
      }

      // Stage 2B: map rooms on floor plans using schedule context
      let roomSpatialMappings: any[] = [];
      try {
        roomSpatialMappings = await this.roomSpatialMappingService.mapRooms(
          roomSchedules,
          ingestResult.sheets || [],
        );
        if (roomSpatialMappings.length) {
          await this.jobsService.mergeJobOptions(jobId, { roomSpatialMappings });
        }
      } catch (spatialError) {
        this.logger.warn(
          `Room spatial mapping failed for job ${jobId}: ${spatialError.message}`,
        );
      }

      // Stage 3A: extract partition type definitions
      let partitionTypes: any[] = [];
      try {
        partitionTypes = await this.partitionTypeExtractionService.extractPartitionTypes(
          ingestResult.sheets || [],
        );
        if (partitionTypes.length) {
          await this.jobsService.mergeJobOptions(jobId, { partitionTypes });
        }
      } catch (partitionError) {
        this.logger.warn(
          `Partition type extraction failed for job ${jobId}: ${partitionError.message}`,
        );
      }

      // Stage 3B: wall run extraction using floor plan imagery
      let wallRuns: any[] = [];
      try {
        wallRuns = await this.wallRunExtractionService.extractWallRuns(
          ingestResult.sheets || [],
          partitionTypes,
        );
        if (wallRuns.length) {
          await this.jobsService.mergeJobOptions(jobId, { wallRuns });
        }
      } catch (wallError) {
        this.logger.warn(
          `Wall run extraction failed for job ${jobId}: ${wallError.message}`,
        );
      }

      // Stage 4: ceiling heights from reflected ceiling plans
      let ceilingHeights: any[] = [];
      try {
        ceilingHeights = await this.ceilingHeightExtractionService.extractHeights(
          ingestResult.sheets || [],
          roomSpatialMappings || [],
        );
        if (ceilingHeights.length) {
          await this.jobsService.mergeJobOptions(jobId, { ceilingHeights });
        }
      } catch (ceilingError) {
        this.logger.warn(
          `Ceiling height extraction failed for job ${jobId}: ${ceilingError.message}`,
        );
      }

      // Stage 5: extract sheet/viewport scale annotations
      let scaleAnnotations: ScaleAnnotation[] = [];
      try {
        scaleAnnotations = await this.scaleExtractionService.extractScales(
          ingestResult.sheets || [],
        );
        if (scaleAnnotations.length) {
          await this.jobsService.mergeJobOptions(jobId, { scaleAnnotations });
        }
      } catch (scaleError) {
        this.logger.warn(
          `Scale extraction failed for job ${jobId}: ${scaleError.message}`,
        );
      }

      // Stage 6: fuse room/wall data for final aggregation
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
        });
        if (fusionData) {
          await this.jobsService.mergeJobOptions(jobId, { fusionData });
        }
      } catch (fusionError) {
        this.logger.warn(
          `Final data fusion failed for job ${jobId}: ${fusionError.message}`,
        );
      }

      // Step 2: Real plan analysis with OpenAI Vision (25% -> 60% progress)
      await this.reportProgress(job, 25);
      
      // Get the actual uploaded file
      const fileBuffer = await this.filesService.getFileBuffer(fileId);
      const file = await this.filesService.getFile(fileId);
      
      this.logger.log(`Starting real plan analysis for ${file.filename} (${file.pages || 'unknown'} pages)`);
      
      // Use OpenAI Vision to analyze the actual plan with progress reporting
      const analysisResult = await this.planAnalysisService.analyzePlanFile(
        fileBuffer,
        file.filename,
        disciplines,
        targets,
        options,
        // Progress callback: Map pages analyzed to 25%-60% range
        async (currentPage: number, totalPages: number, message: string) => {
          const analysisProgress = (currentPage / totalPages);
          const overallProgress = 25 + (analysisProgress * 35); // 25% + up to 35% = 60% max
          await this.reportProgress(job, Math.round(overallProgress));
          this.logger.log(`Progress: ${Math.round(overallProgress)}% - ${message}`);
        }
      );
      
      await this.reportProgress(job, 60);
      
      // Extract features from analysis results
      const features = [];
      for (const pageResult of analysisResult.pages) {
        const pageFeatures = await this.featureExtractionService.extractFeatures(
          jobId,
          pageResult.pageIndex.toString(),
          pageResult.features, // This would be the image buffer in real implementation
          disciplines,
          targets,
          options
        );
        features.push(...pageFeatures);
      }
      
      await this.reportProgress(job, 75);

      // Step 3: Save features to database (80% progress)
      await this.saveFeatures(jobId, features);
      await this.reportProgress(job, 80);

      // Scope diagnosis upgrade - capture CSI divisions, vertical context, fittings
      let scopeDiagnosis: any = undefined;
      try {
        scopeDiagnosis = await this.scopeDiagnosisService.diagnoseScope({
          jobId,
          fileId,
          disciplines,
          targets,
          ingestResult,
          analysisSummary: analysisResult.summary,
          features,
        });
        await this.jobsService.mergeJobOptions(jobId, {
          scopeDiagnosis,
        });
      } catch (scopeError) {
        this.logger.warn(
          `Scope diagnosis failed for job ${jobId}: ${scopeError.message}`,
        );
      }

      await this.generateSchemaTakeoff(jobId, analysisResult.pages || [], analysisResult.summary, features, fusionData);

      // Step 4: Apply materials rules if specified (95% progress)
      if (materialsRuleSetId) {
        await this.rulesEngineService.applyRules(jobId, materialsRuleSetId, features);
      }
      await this.reportProgress(job, 95);

      // Cost intelligence & labor modeling snapshot
      try {
        const costIntelligence =
          this.costIntelligenceService.generateCostSnapshot({
            jobId,
            features,
            scopeDiagnosis,
            materialsRuleSetId,
          });
        const laborModel = this.laborModelingService.buildLaborPlan({
          jobId,
          features,
          disciplines,
          scopeDiagnosis,
        });

        await this.jobsService.mergeJobOptions(jobId, {
          costIntelligence,
          laborModel,
        });
      } catch (costError) {
        this.logger.warn(
          `Cost/labor modeling failed for job ${jobId}: ${costError.message}`,
        );
      }

      // Step 5: Generate artifacts and complete (100% progress)
      await this.generateArtifacts(jobId, ingestResult, features);
      await this.reportProgress(job, 100);

      // Mark job as completed
      await this.jobsService.updateJobStatus(jobId, JobStatus.COMPLETED, 100);
      
      this.logger.log(`Job completed successfully: ${jobId}`);

    } catch (error) {
      this.logger.error(`Job failed: ${jobId}`, error.stack);
      await this.jobsService.updateJobStatus(
        jobId,
        JobStatus.FAILED,
        undefined,
        error.message,
      );
      throw error;
    }
  }

  private async extractFeaturesForTarget(
    ingestResult: any,
    target: string,
    disciplines: string[],
  ): Promise<any[]> {
    // This is a placeholder for the actual feature extraction logic
    // In a real implementation, this would call specific extraction services
    // based on the target type and disciplines
    
    const features = [];
    
    switch (target) {
      case 'rooms':
        // Extract room polygons and areas
        features.push(...await this.extractRooms(ingestResult, disciplines));
        break;
      case 'walls':
        // Extract wall polylines and types
        features.push(...await this.extractWalls(ingestResult, disciplines));
        break;
      case 'doors':
      case 'windows':
        // Extract openings
        features.push(...await this.extractOpenings(ingestResult, target, disciplines));
        break;
      case 'pipes':
        // Extract piping systems
        features.push(...await this.extractPipes(ingestResult, disciplines));
        break;
      case 'ducts':
        // Extract ductwork
        features.push(...await this.extractDucts(ingestResult, disciplines));
        break;
      case 'fixtures':
        // Extract fixtures and equipment
        features.push(...await this.extractFixtures(ingestResult, disciplines));
        break;
    }

    return features;
  }

  // Placeholder extraction methods - these would be implemented with actual CV/BIM logic
  private async extractRooms(ingestResult: any, disciplines: string[]): Promise<any[]> {
    // Mock room extraction
    return [
      {
        type: 'ROOM',
        props: { name: 'SALES AREA', program: 'RETAIL' },
        area: 1265.0,
        // geometry would be actual PostGIS geometry
      }
    ];
  }

  private async reportProgress(job: Job<ProcessJobData>, percent: number): Promise<void> {
    await job.progress(percent);
    await this.jobsService.updateJobStatus(job.data.jobId, JobStatus.PROCESSING, percent);
  }

  private async extractWalls(ingestResult: any, disciplines: string[]): Promise<any[]> {
    // Mock wall extraction
    return [
      {
        type: 'WALL',
        props: { partitionType: 'PT-1' },
        length: 79.25,
        // geometry would be actual PostGIS geometry
      }
    ];
  }

  private async extractOpenings(ingestResult: any, type: string, disciplines: string[]): Promise<any[]> {
    // Mock opening extraction
    return [
      {
        type: 'OPENING',
        props: { openingType: type, width: 3.0 },
        count: 1,
        // geometry would be actual PostGIS geometry
      }
    ];
  }

  private async extractPipes(ingestResult: any, disciplines: string[]): Promise<any[]> {
    // Mock pipe extraction
    return [
      {
        type: 'PIPE',
        props: { service: 'CW', diameterIn: 1.0 },
        length: 88.5,
        // geometry would be actual PostGIS geometry
      }
    ];
  }

  private async extractDucts(ingestResult: any, disciplines: string[]): Promise<any[]> {
    // Mock duct extraction
    return [
      {
        type: 'DUCT',
        props: { size: '12x10' },
        length: 120.0,
        // geometry would be actual PostGIS geometry
      }
    ];
  }

  private async extractFixtures(ingestResult: any, disciplines: string[]): Promise<any[]> {
    // Mock fixture extraction
    return [
      {
        type: 'FIXTURE',
        props: { fixtureType: 'FD2' },
        count: 25,
        // geometry would be actual PostGIS geometry
      }
    ];
  }

  private async generateSchemaTakeoff(
    jobId: string,
    pages: any[],
    summary: any,
    features: any[],
    fusionData?: any,
  ): Promise<void> {
    try {
      const result = await this.takeoffAggregator.aggregate({
        jobId,
        pages,
        summary,
        features,
        fusion: fusionData,
      });
      if (result) {
        await this.jobsService.mergeJobOptions(jobId, { takeoff: result });
      }
    } catch (error) {
      this.logger.warn(`Schema takeoff aggregation failed for job ${jobId}: ${error.message}`);
    }
  }

  private async saveFeatures(jobId: string, features: any[]): Promise<void> {
    // Save features to database with PostGIS geometry
    // This is a placeholder - actual implementation would handle geometry properly
    this.logger.log(`Saving ${features.length} features for job ${jobId}`);
  }

  private async generateArtifacts(jobId: string, ingestResult: any, features: any[]): Promise<void> {
    // Generate overlay images and vector files for visual QA
    // This is a placeholder for artifact generation
    this.logger.log(`Generating artifacts for job ${jobId}`);
  }
}
