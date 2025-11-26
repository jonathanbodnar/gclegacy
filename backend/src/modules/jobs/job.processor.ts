import { Processor, Process } from "@nestjs/bull";
import { Injectable, Logger } from "@nestjs/common";
import { Job } from "bull";
import { JobStatus } from "@prisma/client";

import { JobsService } from "./jobs.service";
import { PrismaService } from "@/common/prisma/prisma.service";
import { IngestService } from "../ingest/ingest.service";
import { RulesEngineService } from "../rules-engine/rules-engine.service";
import { PlanAnalysisService } from "../vision/plan-analysis.service";
import { FeatureExtractionService } from "../vision/feature-extraction.service";
import { TakeoffAggregatorService } from "../vision/takeoff-aggregator.service";
import { SheetClassificationService } from "../vision/sheet-classification.service";
import { FilesService } from "../files/files.service";
import { ScopeDiagnosisService } from "../scope-diagnosis/scope-diagnosis.service";
import { CostIntelligenceService } from "../cost-intelligence/cost-intelligence.service";
import { LaborModelingService } from "../cost-intelligence/labor-modeling.service";
import { RoomScheduleExtractionService } from "../vision/room-schedule-extraction.service";
import { RoomSpatialMappingService } from "../vision/room-spatial-mapping.service";
import { PartitionTypeExtractionService } from "../vision/partition-type-extraction.service";
import { WallRunExtractionService } from "../vision/wall-run-extraction.service";
import { CeilingHeightExtractionService } from "../vision/ceiling-height-extraction.service";
import { FinalDataFusionService } from "../vision/final-data-fusion.service";
import {
  ScaleExtractionService,
  ScaleAnnotation,
} from "../vision/scale-extraction.service";
import {
  SpaceExtractionService,
  SpaceDefinition,
} from "../vision/space-extraction.service";
import {
  MaterialsExtractionService,
  SpaceFinishDefinition,
} from "../vision/materials-extraction.service";

interface ProcessJobData {
  jobId: string;
  fileId: string;
  disciplines: string[];
  targets: string[];
  materialsRuleSetId?: string;
  options?: any;
}

@Injectable()
@Processor("job-processing")
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
    private spaceExtractionService: SpaceExtractionService,
    private materialsExtractionService: MaterialsExtractionService,
    private finalDataFusionService: FinalDataFusionService,
    private prisma: PrismaService
  ) {
    this.logger.log("✅ JobProcessor initialized - ready to process jobs from 'job-processing' queue");
  }

  @Process("process-job")
  async processJob(job: Job<ProcessJobData>) {
    const { jobId, fileId, disciplines, targets, materialsRuleSetId, options } =
      job.data;

    this.logger.log(`🔄 Processing job ${jobId} from queue (Bull job ID: ${job.id})`);
    this.logger.log(`📋 Job data: fileId=${fileId}, disciplines=${disciplines.join(",")}, targets=${targets.join(",")}`);

    // Create a progress reporter that uses Bull job
    const progressReporter = async (percent: number) => {
      try {
        await job.progress(percent);
        await this.jobsService.updateJobStatus(
          job.data.jobId,
          JobStatus.PROCESSING,
          percent
        );
      } catch (error) {
        // Log but don't throw - job might have been deleted
        // This prevents progress updates from failing the entire job
        this.logger.warn(
          `Failed to update progress for job ${job.data.jobId}: ${error.message}`
        );
      }
    };

    try {
      const result = await this.processJobData(
        { jobId, fileId, disciplines, targets, materialsRuleSetId, options },
        progressReporter
      );
      this.logger.log(`✅ Successfully processed job ${jobId}`);
      return result;
    } catch (error) {
      this.logger.error(`❌ Failed to process job ${jobId}:`, error.message);
      throw error;
    }
  }

  /**
   * Core job processing logic that can be called with or without Bull queue
   */
  async processJobData(
    data: ProcessJobData,
    progressReporter: (percent: number) => Promise<void>
  ) {
    const { jobId, fileId, disciplines, targets, materialsRuleSetId, options } =
      data;

    // Only log job start in development - important events are logged as warnings/errors
    if (process.env.NODE_ENV !== "production") {
      this.logger.log(`Starting job processing: ${jobId}`);
    }

    try {
      // Update job status to processing
      this.logger.log(`📊 [Job ${jobId}] Step 0/10: Initializing job processing`);
      await this.jobsService.updateJobStatus(jobId, JobStatus.PROCESSING, 0);

      // Step 1: Ingest and parse file (20% progress)
      this.logger.log(`📊 [Job ${jobId}] Step 1/10: Starting file ingestion (progress: 10%)`);
      await progressReporter(10);
      const ingestResult = await this.ingestService.ingestFile(
        fileId,
        disciplines,
        options
      );
      this.logger.log(`📊 [Job ${jobId}] Step 1/10: File ingestion complete - ${ingestResult.sheets?.length || 0} sheets found (progress: 20%)`);
      await progressReporter(20);

      // Stage 1: classify sheets using GPT (know which pages drive which prompts)
      this.logger.log(`📊 [Job ${jobId}] Step 2/10: Starting sheet classification`);
      try {
        const sheetClassifications =
          await this.sheetClassificationService.classifySheets(
            ingestResult.sheets || []
          );
        await this.jobsService.mergeJobOptions(jobId, {
          sheetClassifications,
        });
        this.logger.log(`📊 [Job ${jobId}] Step 2/10: Sheet classification completed - ${sheetClassifications.length} sheets classified`);
      } catch (classificationError) {
        this.logger.error(
          `📊 [Job ${jobId}] Step 2/10: ❌ Sheet classification failed: ${classificationError.message}`,
          classificationError.stack
        );
      }

      // Stage 2: extract generic spaces from plan sheets
      this.logger.log(`Starting space extraction for job ${jobId}`);
      let spaces: SpaceDefinition[] = [];
      try {
        spaces = await this.spaceExtractionService.extractSpaces(
          ingestResult.sheets || []
        );
        if (spaces.length) {
          await this.jobsService.mergeJobOptions(jobId, { spaces });
        }
        this.logger.log(`Space extraction completed for job ${jobId}: ${spaces.length} spaces extracted`);
      } catch (spaceError) {
        this.logger.warn(
          `Space extraction failed for job ${jobId}: ${spaceError.message}`
        );
      }

      // Stage 2B: finishes/materials extraction for materials sheets
      this.logger.log(`Starting materials extraction for job ${jobId}`);
      let spaceFinishes: SpaceFinishDefinition[] = [];
      try {
        spaceFinishes = await this.materialsExtractionService.extractFinishes(
          ingestResult.sheets || []
        );
        if (spaceFinishes.length) {
          await this.jobsService.mergeJobOptions(jobId, { spaceFinishes });
        }
        this.logger.log(`Materials extraction completed for job ${jobId}: ${spaceFinishes.length} finishes extracted`);
      } catch (materialsError) {
        this.logger.warn(
          `Materials extraction failed for job ${jobId}: ${materialsError.message}`
        );
      }

      // Stage 2A: extract room schedules from text
      this.logger.log(`Starting room schedule extraction for job ${jobId}`);
      let roomSchedules: any[] = [];
      try {
        roomSchedules =
          await this.roomScheduleExtractionService.extractRoomSchedules(
            ingestResult.sheets || []
          );
        if (roomSchedules.length) {
          await this.jobsService.mergeJobOptions(jobId, { roomSchedules });
        }
        this.logger.log(`Room schedule extraction completed for job ${jobId}: ${roomSchedules.length} schedules extracted`);
      } catch (scheduleError) {
        this.logger.warn(
          `Room schedule extraction failed for job ${jobId}: ${scheduleError.message}`
        );
      }

      // Stage 2B: map rooms on floor plans using schedule context
      this.logger.log(`Starting room spatial mapping for job ${jobId}`);
      let roomSpatialMappings: any[] = [];
      try {
        roomSpatialMappings = await this.roomSpatialMappingService.mapRooms(
          roomSchedules,
          ingestResult.sheets || []
        );
        if (roomSpatialMappings.length) {
          await this.jobsService.mergeJobOptions(jobId, {
            roomSpatialMappings,
          });
        }
        this.logger.log(`Room spatial mapping completed for job ${jobId}: ${roomSpatialMappings.length} mappings created`);
      } catch (spatialError) {
        this.logger.warn(
          `Room spatial mapping failed for job ${jobId}: ${spatialError.message}`
        );
      }

      // Stage 3A: extract partition type definitions
      this.logger.log(`Starting partition type extraction for job ${jobId}`);
      let partitionTypes: any[] = [];
      try {
        partitionTypes =
          await this.partitionTypeExtractionService.extractPartitionTypes(
            ingestResult.sheets || []
          );
        if (partitionTypes.length) {
          await this.jobsService.mergeJobOptions(jobId, { partitionTypes });
        }
        this.logger.log(`Partition type extraction completed for job ${jobId}: ${partitionTypes.length} types extracted`);
      } catch (partitionError) {
        this.logger.warn(
          `Partition type extraction failed for job ${jobId}: ${partitionError.message}`
        );
      }

      // Stage 3B: wall run extraction using floor plan imagery
      this.logger.log(`Starting wall run extraction for job ${jobId}`);
      let wallRuns: any[] = [];
      try {
        wallRuns = await this.wallRunExtractionService.extractWallRuns(
          ingestResult.sheets || [],
          partitionTypes,
          spaces
        );
        if (wallRuns.length) {
          await this.jobsService.mergeJobOptions(jobId, { wallRuns });
        }
        this.logger.log(`Wall run extraction completed for job ${jobId}: ${wallRuns.length} wall runs extracted`);
      } catch (wallError) {
        this.logger.warn(
          `Wall run extraction failed for job ${jobId}: ${wallError.message}`
        );
      }

      // Stage 4: ceiling heights from reflected ceiling plans
      this.logger.log(`Starting ceiling height extraction for job ${jobId}`);
      let ceilingHeights: any[] = [];
      try {
        ceilingHeights =
          await this.ceilingHeightExtractionService.extractHeights(
            ingestResult.sheets || [],
            roomSpatialMappings || [],
            spaces || []
          );
        if (ceilingHeights.length) {
          await this.jobsService.mergeJobOptions(jobId, { ceilingHeights });
        }
        this.logger.log(`Ceiling height extraction completed for job ${jobId}: ${ceilingHeights.length} heights extracted`);
      } catch (ceilingError) {
        this.logger.warn(
          `Ceiling height extraction failed for job ${jobId}: ${ceilingError.message}`
        );
      }

      // Stage 5: extract sheet/viewport scale annotations
      this.logger.log(`Starting scale extraction for job ${jobId}`);
      let scaleAnnotations: ScaleAnnotation[] = [];
      try {
        scaleAnnotations = await this.scaleExtractionService.extractScales(
          ingestResult.sheets || []
        );
        if (scaleAnnotations.length) {
          await this.jobsService.mergeJobOptions(jobId, { scaleAnnotations });
        }
        this.logger.log(`Scale extraction completed for job ${jobId}: ${scaleAnnotations.length} scales extracted`);
      } catch (scaleError) {
        this.logger.warn(
          `Scale extraction failed for job ${jobId}: ${scaleError.message}`
        );
      }

      // Stage 6: fuse room/wall data for final aggregation
      this.logger.log(`Starting final data fusion for job ${jobId}`);
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
          await this.jobsService.mergeJobOptions(jobId, { fusionData });
        }
        this.logger.log(`Final data fusion completed for job ${jobId}`);
      } catch (fusionError) {
        this.logger.warn(
          `Final data fusion failed for job ${jobId}: ${fusionError.message}`
        );
      }

      // Step 2: Real plan analysis with OpenAI Vision (25% -> 60% progress)
      await progressReporter(25);

      // Get the actual uploaded file
      const fileBuffer = await this.filesService.getFileBuffer(fileId);
      const file = await this.filesService.getFile(fileId);

      // Force logging for debugging (temporarily enabled)
      this.logger.log(
        `Starting real plan analysis for ${file.filename} (${file.pages || "unknown"} pages)`
      );

      // Use OpenAI Vision to analyze the actual plan with progress reporting
      const analysisResult = await this.planAnalysisService.analyzePlanFile(
        fileBuffer,
        file.filename,
        disciplines,
        targets,
        options,
        // Progress callback: Map pages analyzed to 25%-60% range
        async (currentPage: number, totalPages: number, message: string) => {
          const analysisProgress = currentPage / totalPages;
          const overallProgress = 25 + analysisProgress * 35; // 25% + up to 35% = 60% max
          await progressReporter(Math.round(overallProgress));
          // Force logging for debugging (temporarily enabled)
          this.logger.log(
            `Progress: ${Math.round(overallProgress)}% - ${message}`
          );
        }
      );

      await progressReporter(60);

      // Extract features from analysis results
      const features = [];
      for (const pageResult of analysisResult.pages) {
        const pageFeatures =
          await this.featureExtractionService.extractFeatures(
            jobId,
            pageResult.pageIndex.toString(),
            pageResult.features, // This would be the image buffer in real implementation
            disciplines,
            targets,
            options
          );
        features.push(...pageFeatures);
      }

      await progressReporter(75);

      // Step 3: Features are already saved by extractFeatures, ensure we have features with IDs
      // If features array is empty or doesn't have IDs, fetch from database
      let featuresToUse = features;
      if (features.length === 0 || features.some((f) => !f.id)) {
        if (process.env.NODE_ENV !== "production") {
          this.logger.log(`Fetching features from database for job ${jobId}`);
        }
        featuresToUse = await this.prisma.feature.findMany({
          where: { jobId },
        });
        if (process.env.NODE_ENV !== "production") {
          this.logger.log(
            `Found ${featuresToUse.length} features in database for job ${jobId}`
          );
        }
      } else {
        if (process.env.NODE_ENV !== "production") {
          this.logger.log(
            `Using ${features.length} extracted features with IDs for job ${jobId}`
          );
        }
      }
      await progressReporter(80);

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
          features: featuresToUse,
        });
        await this.jobsService.mergeJobOptions(jobId, {
          scopeDiagnosis,
        });
      } catch (scopeError) {
        this.logger.warn(
          `Scope diagnosis failed for job ${jobId}: ${scopeError.message}`
        );
      }

      await this.generateSchemaTakeoff(
        jobId,
        analysisResult.pages || [],
        analysisResult.summary,
        featuresToUse,
        fusionData
      );

      // Step 4: Apply materials rules (95% progress)
      // Use provided rule set or default to "Standard Commercial Rules"
      const ruleSetIdToUse =
        materialsRuleSetId || (await this.getDefaultRuleSetId());
      if (ruleSetIdToUse) {
        try {
          if (process.env.NODE_ENV !== "production") {
            this.logger.log(
              `Applying rules ${ruleSetIdToUse} to ${featuresToUse.length} features for job ${jobId}`
            );
          }
          await this.rulesEngineService.applyRules(
            jobId,
            ruleSetIdToUse,
            featuresToUse
          );
          if (process.env.NODE_ENV !== "production") {
            this.logger.log(
              `Applied materials rules ${ruleSetIdToUse} to job ${jobId}`
            );
          }
        } catch (rulesError) {
          this.logger.warn(
            `Materials rules application failed for job ${jobId}: ${rulesError.message}`
          );
        }
      } else {
        this.logger.warn(
          `No materials rule set available for job ${jobId}. Materials will not be generated.`
        );
      }
      await progressReporter(95);

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
          `Cost/labor modeling failed for job ${jobId}: ${costError.message}`
        );
      }

      // Step 5: Generate artifacts and complete (100% progress)
      await this.generateArtifacts(jobId, ingestResult, featuresToUse);
      await progressReporter(100);

      // Mark job as completed
      await this.jobsService.updateJobStatus(jobId, JobStatus.COMPLETED, 100);

      // Log completion as info in production (important event)
      if (process.env.NODE_ENV === "production") {
        this.logger.warn(`Job completed successfully: ${jobId}`); // Use warn level so it shows in production
      } else {
        this.logger.log(`Job completed successfully: ${jobId}`);
      }
    } catch (error) {
      this.logger.error(`Job failed: ${jobId}`, error.stack);
      await this.jobsService.updateJobStatus(
        jobId,
        JobStatus.FAILED,
        undefined,
        error.message
      );
      throw error;
    }
  }

  private async extractFeaturesForTarget(
    ingestResult: any,
    target: string,
    disciplines: string[]
  ): Promise<any[]> {
    // This is a placeholder for the actual feature extraction logic
    // In a real implementation, this would call specific extraction services
    // based on the target type and disciplines

    const features = [];

    switch (target) {
      case "rooms":
        // Extract room polygons and areas
        features.push(...(await this.extractRooms(ingestResult, disciplines)));
        break;
      case "walls":
        // Extract wall polylines and types
        features.push(...(await this.extractWalls(ingestResult, disciplines)));
        break;
      case "doors":
      case "windows":
        // Extract openings
        features.push(
          ...(await this.extractOpenings(ingestResult, target, disciplines))
        );
        break;
      case "pipes":
        // Extract piping systems
        features.push(...(await this.extractPipes(ingestResult, disciplines)));
        break;
      case "ducts":
        // Extract ductwork
        features.push(...(await this.extractDucts(ingestResult, disciplines)));
        break;
      case "fixtures":
        // Extract fixtures and equipment
        features.push(
          ...(await this.extractFixtures(ingestResult, disciplines))
        );
        break;
    }

    return features;
  }

  // Placeholder extraction methods - these would be implemented with actual CV/BIM logic
  private async extractRooms(
    ingestResult: any,
    disciplines: string[]
  ): Promise<any[]> {
    // Mock room extraction
    return [
      {
        type: "ROOM",
        props: { name: "SALES AREA", program: "RETAIL" },
        area: 1265.0,
        // geometry would be actual PostGIS geometry
      },
    ];
  }

  private async extractWalls(
    ingestResult: any,
    disciplines: string[]
  ): Promise<any[]> {
    // Mock wall extraction
    return [
      {
        type: "WALL",
        props: { partitionType: "PT-1" },
        length: 79.25,
        // geometry would be actual PostGIS geometry
      },
    ];
  }

  private async extractOpenings(
    ingestResult: any,
    type: string,
    disciplines: string[]
  ): Promise<any[]> {
    // Mock opening extraction
    return [
      {
        type: "OPENING",
        props: { openingType: type, width: 3.0 },
        count: 1,
        // geometry would be actual PostGIS geometry
      },
    ];
  }

  private async extractPipes(
    ingestResult: any,
    disciplines: string[]
  ): Promise<any[]> {
    // Mock pipe extraction
    return [
      {
        type: "PIPE",
        props: { service: "CW", diameterIn: 1.0 },
        length: 88.5,
        // geometry would be actual PostGIS geometry
      },
    ];
  }

  private async extractDucts(
    ingestResult: any,
    disciplines: string[]
  ): Promise<any[]> {
    // Mock duct extraction
    return [
      {
        type: "DUCT",
        props: { size: "12x10" },
        length: 120.0,
        // geometry would be actual PostGIS geometry
      },
    ];
  }

  private async extractFixtures(
    ingestResult: any,
    disciplines: string[]
  ): Promise<any[]> {
    // Mock fixture extraction
    return [
      {
        type: "FIXTURE",
        props: { fixtureType: "FD2" },
        count: 25,
        // geometry would be actual PostGIS geometry
      },
    ];
  }

  private async generateSchemaTakeoff(
    jobId: string,
    pages: any[],
    summary: any,
    features: any[],
    fusionData?: any
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
      this.logger.warn(
        `Schema takeoff aggregation failed for job ${jobId}: ${error.message}`
      );
    }
  }

  private async generateArtifacts(
    jobId: string,
    ingestResult: any,
    features: any[]
  ): Promise<void> {
    // Generate overlay images and vector files for visual QA
    // This is a placeholder for artifact generation
    if (process.env.NODE_ENV !== "production") {
      this.logger.log(`Generating artifacts for job ${jobId}`);
    }
  }

  /**
   * Get the default materials rule set ID (Standard Commercial Rules)
   * Returns null if no default rule set is found
   */
  private async getDefaultRuleSetId(): Promise<string | null> {
    try {
      const ruleSet = await this.prisma.materialsRuleSet.findUnique({
        where: {
          name_version: {
            name: "Standard Commercial Rules",
            version: "1.0",
          },
        },
      });
      return ruleSet?.id || null;
    } catch (error) {
      this.logger.warn(`Failed to get default rule set: ${error.message}`);
      return null;
    }
  }
}
