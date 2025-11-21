import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Optional,
  Logger,
  ServiceUnavailableException,
  Inject,
  forwardRef,
} from "@nestjs/common";
import { InjectQueue } from "@nestjs/bull";
import { Queue } from "bull";
import { PrismaService } from "@/common/prisma/prisma.service";
import { JobStatus } from "@prisma/client";
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library";

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
        type?: "plan" | "elevation" | "section";
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

  private jobProcessor: any; // Use any to avoid circular dependency

  constructor(
    private prisma: PrismaService,
    @Optional() @InjectQueue("job-processing") private jobQueue?: Queue
  ) {
    if (!this.jobQueue) {
      this.logger.warn(
        "⚠️  Job queue not available - jobs will be processed synchronously"
      );
    }
  }

  // Set job processor after construction to avoid circular dependency
  setJobProcessor(processor: any) {
    this.jobProcessor = processor;
  }

  async createJob(
    createJobDto: CreateJobDto
  ): Promise<{ jobId: string; status: JobStatus }> {
    try {
      // Validate file exists
      const file = await this.prisma.file.findUnique({
        where: { id: createJobDto.fileId },
      });

      if (!file) {
        throw new BadRequestException("File not found");
      }
    } catch (error) {
      if (
        error instanceof PrismaClientKnownRequestError ||
        error instanceof Error
      ) {
        if (
          error.message?.includes("Can't reach database server") ||
          error.message?.includes("database server")
        ) {
          this.logger.error("Database connection failed:", error.message);
          throw new ServiceUnavailableException(
            "Database service is currently unavailable. Please try again later."
          );
        }
      }
      throw error;
    }

    // Validate disciplines
    const validDisciplines = ["A", "P", "M", "E"];
    const invalidDisciplines = createJobDto.disciplines.filter(
      (d) => !validDisciplines.includes(d)
    );
    if (invalidDisciplines.length > 0) {
      throw new BadRequestException(
        `Invalid disciplines: ${invalidDisciplines.join(", ")}`
      );
    }

    // Normalize and validate targets (supporting aliases like "vertical")
    const normalizedTargets = this.normalizeTargets(createJobDto.targets);
    const validTargets = [
      "rooms",
      "walls",
      "doors",
      "windows",
      "pipes",
      "ducts",
      "fixtures",
      "elevations",
      "sections",
      "risers",
      "levels",
    ];
    const invalidTargets = normalizedTargets.filter(
      (t) => !validTargets.includes(t)
    );
    if (invalidTargets.length > 0) {
      throw new BadRequestException(
        `Invalid targets: ${invalidTargets.join(", ")}`
      );
    }

    // Create job record
    let job;
    try {
      job = await this.prisma.job.create({
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
    } catch (error) {
      if (
        error instanceof PrismaClientKnownRequestError ||
        error instanceof Error
      ) {
        if (
          error.message?.includes("Can't reach database server") ||
          error.message?.includes("database server")
        ) {
          this.logger.error("Database connection failed:", error.message);
          throw new ServiceUnavailableException(
            "Database service is currently unavailable. Please try again later."
          );
        }
      }
      throw error;
    }

    // Add to processing queue (if available)
    if (this.jobQueue) {
      await this.jobQueue.add(
        "process-job",
        {
          jobId: job.id,
          fileId: createJobDto.fileId,
          disciplines: createJobDto.disciplines,
          targets: normalizedTargets,
          materialsRuleSetId: createJobDto.materialsRuleSetId,
          options: createJobDto.options,
        },
        {
          attempts: 3,
          backoff: {
            type: "exponential",
            delay: 2000,
          },
        }
      );
    } else {
      // No queue available - process synchronously in background
      this.logger.warn(
        `Job ${job.id} created but queue not available - processing synchronously`
      );

      // Process job directly in background (non-blocking)
      if (this.jobProcessor) {
        // Process asynchronously without blocking the response
        this.processJobDirectly({
          jobId: job.id,
          fileId: createJobDto.fileId,
          disciplines: createJobDto.disciplines,
          targets: normalizedTargets,
          materialsRuleSetId: createJobDto.materialsRuleSetId,
          options: createJobDto.options,
        }).catch((error) => {
          this.logger.error(
            `Failed to process job ${job.id} directly:`,
            error.message
          );
        });
      } else {
        // Job processor not available yet - log warning
        this.logger.warn(
          `Job processor not available for job ${job.id} - will process when processor is ready`
        );
        try {
          await this.prisma.job.update({
            where: { id: job.id },
            data: {
              error:
                "Queue not available - processing will start when processor is ready",
            },
          });
        } catch (error) {
          this.logger.warn(
            `Failed to update job ${job.id} with queue error:`,
            error.message
          );
        }
      }
    }

    return {
      jobId: job.id,
      status: job.status,
    };
  }

  async getJobStatus(jobId: string): Promise<JobStatusResponse> {
    try {
      const job = await this.prisma.job.findUnique({
        where: { id: jobId },
      });

      if (!job) {
        throw new NotFoundException("Job not found");
      }

      return {
        jobId: job.id,
        status: job.status,
        progress: job.progress,
        error: job.error,
        startedAt: job.startedAt,
        finishedAt: job.finishedAt,
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      if (
        error instanceof PrismaClientKnownRequestError ||
        error instanceof Error
      ) {
        if (
          error.message?.includes("Can't reach database server") ||
          error.message?.includes("database server")
        ) {
          this.logger.error("Database connection failed:", error.message);
          throw new ServiceUnavailableException(
            "Database service is currently unavailable. Please try again later."
          );
        }
      }
      throw error;
    }
  }

  async updateJobStatus(
    jobId: string,
    status: JobStatus,
    progress?: number,
    error?: string
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

    try {
      await this.prisma.job.update({
        where: { id: jobId },
        data: updateData,
      });
    } catch (error) {
      if (
        error instanceof PrismaClientKnownRequestError ||
        error instanceof Error
      ) {
        if (
          error.message?.includes("Can't reach database server") ||
          error.message?.includes("database server")
        ) {
          this.logger.error(
            `Database connection failed while updating job ${jobId}:`,
            error.message
          );
          throw new ServiceUnavailableException(
            "Database service is currently unavailable. Please try again later."
          );
        }
      }
      throw error;
    }
  }

  async cancelJob(jobId: string): Promise<void> {
    let job;
    try {
      job = await this.prisma.job.findUnique({
        where: { id: jobId },
      });

      if (!job) {
        throw new NotFoundException("Job not found");
      }

      if (
        job.status === JobStatus.COMPLETED ||
        job.status === JobStatus.FAILED
      ) {
        throw new BadRequestException("Cannot cancel completed or failed job");
      }

      // Update job status
      await this.updateJobStatus(jobId, JobStatus.CANCELLED);

      // Remove from queue if still queued and queue is available
      if (job.status === JobStatus.QUEUED && this.jobQueue) {
        const jobs = await this.jobQueue.getJobs(["waiting", "active"]);
        const queueJob = jobs.find((j) => j.data.jobId === jobId);
        if (queueJob) {
          await queueJob.remove();
        }
      }
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      if (
        error instanceof PrismaClientKnownRequestError ||
        error instanceof Error
      ) {
        if (
          error.message?.includes("Can't reach database server") ||
          error.message?.includes("database server")
        ) {
          this.logger.error("Database connection failed:", error.message);
          throw new ServiceUnavailableException(
            "Database service is currently unavailable. Please try again later."
          );
        }
      }
      throw error;
    }
  }

  async getJobsByStatus(status: JobStatus): Promise<JobStatusResponse[]> {
    try {
      const jobs = await this.prisma.job.findMany({
        where: { status },
        orderBy: { createdAt: "desc" },
      });

      return jobs.map((job) => ({
        jobId: job.id,
        status: job.status,
        progress: job.progress,
        error: job.error,
        startedAt: job.startedAt,
        finishedAt: job.finishedAt,
      }));
    } catch (error) {
      if (
        error instanceof PrismaClientKnownRequestError ||
        error instanceof Error
      ) {
        if (
          error.message?.includes("Can't reach database server") ||
          error.message?.includes("database server")
        ) {
          this.logger.error("Database connection failed:", error.message);
          throw new ServiceUnavailableException(
            "Database service is currently unavailable. Please try again later."
          );
        }
      }
      throw error;
    }
  }

  private normalizeTargets(targets: string[]): string[] {
    const targetAliases: Record<string, string[]> = {
      vertical: ["elevations", "sections", "risers", "levels"],
    };

    const expanded = targets.flatMap(
      (target) => targetAliases[target] || [target]
    );

    return Array.from(new Set(expanded));
  }

  async mergeJobOptions(
    jobId: string,
    patch: Record<string, any>
  ): Promise<void> {
    try {
      const job = await this.prisma.job.findUnique({
        where: { id: jobId },
        select: { options: true },
      });

      const baseOptions =
        job?.options &&
        typeof job.options === "object" &&
        !Array.isArray(job.options)
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
    } catch (error) {
      if (
        error instanceof PrismaClientKnownRequestError ||
        error instanceof Error
      ) {
        if (
          error.message?.includes("Can't reach database server") ||
          error.message?.includes("database server")
        ) {
          this.logger.error("Database connection failed:", error.message);
          throw new ServiceUnavailableException(
            "Database service is currently unavailable. Please try again later."
          );
        }
      }
      throw error;
    }
  }

  /**
   * Clear all jobs from the Bull queue and delete them from the database
   * This will:
   * 1. Remove all waiting, active, and delayed jobs from the queue
   * 2. Delete QUEUED and PROCESSING jobs from the database (cascade deletes related data)
   * @returns Object with counts of jobs cleared
   */
  async clearAllJobs(): Promise<{
    queueJobsRemoved: number;
    databaseJobsDeleted: number;
  }> {
    let queueJobsRemoved = 0;
    let databaseJobsDeleted = 0;

    try {
      // Step 1: Clear all jobs from Bull queue if available
      if (this.jobQueue) {
        try {
          // Get all jobs in various states
          const waitingJobs = await this.jobQueue.getJobs(["waiting"]);
          const activeJobs = await this.jobQueue.getJobs(["active"]);
          const delayedJobs = await this.jobQueue.getJobs(["delayed"]);

          // Remove all jobs from queue
          for (const job of [...waitingJobs, ...activeJobs, ...delayedJobs]) {
            try {
              await job.remove();
              queueJobsRemoved++;
              this.logger.log(
                `Removed job ${job.id} from queue (jobId: ${job.data?.jobId || "unknown"})`
              );
            } catch (error: any) {
              this.logger.warn(
                `Failed to remove job ${job.id} from queue:`,
                error?.message || String(error)
              );
            }
          }

          // Also clear the entire queue using empty() method
          await this.jobQueue.empty();
          this.logger.log(
            `Emptied job queue: ${queueJobsRemoved} jobs removed`
          );
        } catch (error: any) {
          this.logger.error(
            "Error clearing queue:",
            error?.message || String(error)
          );
          // Continue to database cleanup even if queue clearing fails
        }
      } else {
        this.logger.warn("Job queue not available - skipping queue cleanup");
      }

      // Step 2: Delete QUEUED and PROCESSING jobs from database
      // This will cascade delete related sheets, features, and materials
      try {
        // First, get count of jobs to be deleted for logging
        const jobsToDelete = await this.prisma.job.findMany({
          where: {
            status: {
              in: [JobStatus.QUEUED, JobStatus.PROCESSING],
            },
          },
          select: { id: true },
        });

        const jobIds = jobsToDelete.map((j) => j.id);
        this.logger.log(
          `Found ${jobIds.length} jobs to delete: ${jobIds.join(", ")}`
        );

        // Delete jobs (cascade will handle related data)
        const result = await this.prisma.job.deleteMany({
          where: {
            status: {
              in: [JobStatus.QUEUED, JobStatus.PROCESSING],
            },
          },
        });

        databaseJobsDeleted = result.count;
        this.logger.log(`Deleted ${databaseJobsDeleted} jobs from database`);

        if (databaseJobsDeleted === 0) {
          this.logger.warn(
            "No QUEUED or PROCESSING jobs found to delete. Jobs may already be completed, failed, or cancelled."
          );
        }
      } catch (error: any) {
        if (
          error instanceof PrismaClientKnownRequestError ||
          error instanceof Error
        ) {
          if (
            error.message?.includes("Can't reach database server") ||
            error.message?.includes("database server")
          ) {
            this.logger.error("Database connection failed:", error.message);
            throw new ServiceUnavailableException(
              "Database service is currently unavailable. Please try again later."
            );
          }
        }
        this.logger.error(
          "Error deleting jobs from database:",
          error?.message || String(error)
        );
        throw error;
      }

      return {
        queueJobsRemoved,
        databaseJobsDeleted,
      };
    } catch (error: any) {
      if (error instanceof ServiceUnavailableException) {
        throw error;
      }
      this.logger.error(
        "Error clearing all jobs:",
        error?.message || String(error)
      );
      throw error;
    }
  }

  /**
   * Process job directly without Bull queue (fallback when Redis is not available)
   */
  private async processJobDirectly(jobData: {
    jobId: string;
    fileId: string;
    disciplines: string[];
    targets: string[];
    materialsRuleSetId?: string;
    options?: any;
  }): Promise<void> {
    if (!this.jobProcessor) {
      throw new Error("Job processor not available");
    }

    // Create a simple progress reporter that updates job status
    const progressReporter = async (percent: number) => {
      await this.updateJobStatus(jobData.jobId, JobStatus.PROCESSING, percent);
    };

    // Call the processor's processJobData method
    await this.jobProcessor.processJobData(jobData, progressReporter);
  }

  /**
   * Process existing queued jobs (useful when Redis becomes unavailable or on startup)
   */
  async processQueuedJobs(): Promise<number> {
    if (this.jobQueue) {
      // If queue is available, jobs will be processed automatically
      return 0;
    }

    if (!this.jobProcessor) {
      this.logger.warn(
        "Job processor not available - cannot process queued jobs"
      );
      return 0;
    }

    try {
      // Find all queued jobs
      const queuedJobs = await this.prisma.job.findMany({
        where: {
          status: JobStatus.QUEUED,
        },
        orderBy: {
          createdAt: "asc", // Process oldest first
        },
      });

      if (queuedJobs.length === 0) {
        return 0;
      }

      this.logger.log(
        `Found ${queuedJobs.length} queued jobs to process (Redis not available)`
      );

      // Process each job in the background
      for (const job of queuedJobs) {
        // Clear any error message from previous attempts
        await this.prisma.job.update({
          where: { id: job.id },
          data: { error: null },
        });

        // Process asynchronously
        this.processJobDirectly({
          jobId: job.id,
          fileId: job.fileId,
          disciplines: job.disciplines as string[],
          targets: job.targets as string[],
          materialsRuleSetId: job.materialsRuleSetId || undefined,
          options: (job.options as any) || {},
        }).catch((error) => {
          this.logger.error(
            `Failed to process queued job ${job.id}:`,
            error.message
          );
        });
      }

      return queuedJobs.length;
    } catch (error) {
      this.logger.error("Error processing queued jobs:", error.message);
      return 0;
    }
  }
}
