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
import { FilesService } from '../files/files.service';

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
      await this.generateSchemaTakeoff(jobId, analysisResult.pages || [], analysisResult.summary, features);

      // Step 4: Apply materials rules if specified (95% progress)
      if (materialsRuleSetId) {
        await this.rulesEngineService.applyRules(jobId, materialsRuleSetId, features);
      }
      await this.reportProgress(job, 95);

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
  ): Promise<void> {
    try {
      const result = await this.takeoffAggregator.aggregate({
        jobId,
        pages,
        summary,
        features,
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
