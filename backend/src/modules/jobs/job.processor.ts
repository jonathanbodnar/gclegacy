import { Processor, Process } from '@nestjs/bull';
import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bull';
import { JobStatus } from '@prisma/client';

import { JobsService } from './jobs.service';
import { IngestService } from '../ingest/ingest.service';
import { RulesEngineService } from '../rules-engine/rules-engine.service';
import { PlanAnalysisService } from '../vision/plan-analysis.service';
import { FeatureExtractionService } from '../vision/feature-extraction.service';

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
  ) {}

  @Process('process-job')
  async processJob(job: Job<ProcessJobData>) {
    const { jobId, fileId, disciplines, targets, materialsRuleSetId, options } = job.data;
    
    this.logger.log(`Starting job processing: ${jobId}`);

    try {
      // Update job status to processing
      await this.jobsService.updateJobStatus(jobId, JobStatus.PROCESSING, 0);

      // Step 1: Ingest and parse file (20% progress)
      await job.progress(10);
      const ingestResult = await this.ingestService.ingestFile(fileId, disciplines, options);
      await job.progress(20);

      // Step 2: Extract features based on targets (60% progress)
      const features = [];
      const progressPerTarget = 40 / targets.length;
      let currentProgress = 20;

      for (const target of targets) {
        this.logger.log(`Processing target: ${target} for job ${jobId}`);
        
        const targetFeatures = await this.extractFeaturesForTarget(
          ingestResult,
          target,
          disciplines,
        );
        features.push(...targetFeatures);

        currentProgress += progressPerTarget;
        await job.progress(currentProgress);
      }

      // Step 3: Save features to database (80% progress)
      await this.saveFeatures(jobId, features);
      await job.progress(80);

      // Step 4: Apply materials rules if specified (95% progress)
      if (materialsRuleSetId) {
        await this.rulesEngineService.applyRules(jobId, materialsRuleSetId, features);
      }
      await job.progress(95);

      // Step 5: Generate artifacts and complete (100% progress)
      await this.generateArtifacts(jobId, ingestResult, features);
      await job.progress(100);

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
