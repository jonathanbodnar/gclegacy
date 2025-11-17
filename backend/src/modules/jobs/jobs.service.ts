import { Injectable, BadRequestException, NotFoundException, Optional, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { PrismaService } from '@/common/prisma/prisma.service';
import { JobStatus } from '@prisma/client';

export interface CreateJobDto {
  fileId: string;
  disciplines: string[];
  targets: string[];
  materialsRuleSetId?: string;
  webhookUrl?: string;
  options?: {
    bimPreferred?: boolean;
    inferScale?: boolean;
    defaultStoryHeightFt?: number;
    levelOverrides?: Record<string, number>;
    sheetOverrides?: Record<
      string,
      {
        type?: 'plan' | 'elevation' | 'section';
        defaultStoryHeightFt?: number;
        levels?: string[];
      }
    >;
    [key: string]: any;
  };
}

export interface JobStatusResponse {
  jobId: string;
  status: JobStatus;
  progress: number;
  error?: string;
  startedAt?: Date;
  finishedAt?: Date;
}

@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);
  
  constructor(
    private prisma: PrismaService,
    @Optional() @InjectQueue('job-processing') private jobQueue?: Queue,
  ) {
    if (!this.jobQueue) {
      this.logger.warn('⚠️  Job queue not available - jobs will be processed synchronously');
    }
  }

  async createJob(createJobDto: CreateJobDto): Promise<{ jobId: string; status: JobStatus }> {
    // Validate file exists
    const file = await this.prisma.file.findUnique({
      where: { id: createJobDto.fileId },
    });

    if (!file) {
      throw new BadRequestException('File not found');
    }

    // Validate disciplines
    const validDisciplines = ['A', 'P', 'M', 'E'];
    const invalidDisciplines = createJobDto.disciplines.filter(
      d => !validDisciplines.includes(d)
    );
    if (invalidDisciplines.length > 0) {
      throw new BadRequestException(`Invalid disciplines: ${invalidDisciplines.join(', ')}`);
    }

    // Normalize and validate targets (supporting aliases like "vertical")
    const normalizedTargets = this.normalizeTargets(createJobDto.targets);
    const validTargets = [
      'rooms',
      'walls',
      'doors',
      'windows',
      'pipes',
      'ducts',
      'fixtures',
      'elevations',
      'sections',
      'risers',
      'levels',
    ];
    const invalidTargets = normalizedTargets.filter(
      t => !validTargets.includes(t)
    );
    if (invalidTargets.length > 0) {
      throw new BadRequestException(`Invalid targets: ${invalidTargets.join(', ')}`);
    }

    // Create job record
    const job = await this.prisma.job.create({
      data: {
        fileId: createJobDto.fileId,
        disciplines: createJobDto.disciplines,
        targets: normalizedTargets,
        materialsRuleSetId: createJobDto.materialsRuleSetId,
        webhookUrl: createJobDto.webhookUrl,
        options: createJobDto.options || {},
        status: JobStatus.QUEUED,
      },
    });

    // Add to processing queue (if available)
    if (this.jobQueue) {
      await this.jobQueue.add('process-job', {
        jobId: job.id,
        fileId: createJobDto.fileId,
        disciplines: createJobDto.disciplines,
        targets: normalizedTargets,
        materialsRuleSetId: createJobDto.materialsRuleSetId,
        options: createJobDto.options,
      }, {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
      });
    } else {
      // No queue available - keep as QUEUED with note in error field
      this.logger.warn(`Job ${job.id} created but queue not available - will need manual processing`);
      await this.prisma.job.update({
        where: { id: job.id },
        data: { 
          error: 'Queue not available - awaiting manual processing or Redis configuration'
        },
      });
    }

    return {
      jobId: job.id,
      status: job.status,
    };
  }

  async getJobStatus(jobId: string): Promise<JobStatusResponse> {
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
    });

    if (!job) {
      throw new NotFoundException('Job not found');
    }

    return {
      jobId: job.id,
      status: job.status,
      progress: job.progress,
      error: job.error,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
    };
  }

  async updateJobStatus(
    jobId: string,
    status: JobStatus,
    progress?: number,
    error?: string,
  ): Promise<void> {
    const updateData: any = { status, updatedAt: new Date() };
    
    if (progress !== undefined) {
      updateData.progress = progress;
    }
    
    if (error) {
      updateData.error = error;
    }

    if (status === JobStatus.PROCESSING && !updateData.startedAt) {
      updateData.startedAt = new Date();
    }

    if (status === JobStatus.COMPLETED || status === JobStatus.FAILED) {
      updateData.finishedAt = new Date();
    }

    await this.prisma.job.update({
      where: { id: jobId },
      data: updateData,
    });
  }

  async cancelJob(jobId: string): Promise<void> {
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
    });

    if (!job) {
      throw new NotFoundException('Job not found');
    }

    if (job.status === JobStatus.COMPLETED || job.status === JobStatus.FAILED) {
      throw new BadRequestException('Cannot cancel completed or failed job');
    }

    // Update job status
    await this.updateJobStatus(jobId, JobStatus.CANCELLED);

    // Remove from queue if still queued and queue is available
    if (job.status === JobStatus.QUEUED && this.jobQueue) {
      const jobs = await this.jobQueue.getJobs(['waiting', 'active']);
      const queueJob = jobs.find(j => j.data.jobId === jobId);
      if (queueJob) {
        await queueJob.remove();
      }
    }
  }

  async getJobsByStatus(status: JobStatus): Promise<JobStatusResponse[]> {
    const jobs = await this.prisma.job.findMany({
      where: { status },
      orderBy: { createdAt: 'desc' },
    });

    return jobs.map(job => ({
      jobId: job.id,
      status: job.status,
      progress: job.progress,
      error: job.error,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
    }));
  }

  private normalizeTargets(targets: string[]): string[] {
    const targetAliases: Record<string, string[]> = {
      vertical: ['elevations', 'sections', 'risers', 'levels'],
    };

    const expanded = targets.flatMap(target => targetAliases[target] || [target]);

    return Array.from(new Set(expanded));
  }

  async mergeJobOptions(jobId: string, patch: Record<string, any>): Promise<void> {
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      select: { options: true },
    });

    const baseOptions =
      job?.options && typeof job.options === 'object' && !Array.isArray(job.options)
        ? (job.options as Record<string, any>)
        : {};

    const mergedOptions = {
      ...baseOptions,
      ...patch,
    };

    await this.prisma.job.update({
      where: { id: jobId },
      data: { options: mergedOptions },
    });
  }
}
