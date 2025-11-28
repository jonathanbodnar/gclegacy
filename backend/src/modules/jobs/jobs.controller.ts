import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiProperty,
} from "@nestjs/swagger";
import { IsString, IsArray, IsOptional, IsBoolean } from "class-validator";

import { JobsService, CreateJobDto, JobStatusResponse } from "./jobs.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";

class CreateJobRequest {
  @ApiProperty({ example: "file_abc123" })
  @IsString()
  fileId: string;

  @ApiProperty({ example: ["A", "P", "M", "E"] })
  @IsArray()
  @IsString({ each: true })
  disciplines: string[];

  @ApiProperty({
    example: ["rooms", "walls", "pipes", "fixtures", "vertical"],
  })
  @IsArray()
  @IsString({ each: true })
  targets: string[];

  @ApiProperty({ required: false, example: "mrs_001" })
  @IsOptional()
  @IsString()
  materialsRuleSetId?: string;

  @ApiProperty({ required: false, example: "https://yourapp.com/hooks/plan" })
  @IsOptional()
  @IsString()
  webhookUrl?: string;

  @ApiProperty({
    required: false,
    description:
      "Optional tuning flags (scale overrides, story heights, sheet metadata).",
    example: {
      inferScale: true,
      defaultStoryHeightFt: 12,
      levelOverrides: {
        "Level 1": 0,
        "Level 2": 12,
      },
    },
  })
  @IsOptional()
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

class CreateJobResponse {
  @ApiProperty({ example: "job_xyz789" })
  jobId: string;

  @ApiProperty({ example: "QUEUED" })
  status: string;
}

@ApiTags("Jobs")
@Controller("jobs")
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

  // Mapping of disciplines to their valid targets
  private readonly disciplineTargetMap: Record<string, string[]> = {
    A: ['rooms', 'walls', 'doors', 'windows'],
    P: ['pipes', 'fixtures'],
    M: ['ducts'],
    E: ['fixtures']
  };

  /**
   * Validate that all targets are valid for the selected disciplines
   */
  private validateDisciplinesAndTargets(disciplines: string[], targets: string[]): void {
    // Get all valid targets for selected disciplines
    const validTargets = new Set<string>();
    for (const discipline of disciplines) {
      const targetsForDiscipline = this.disciplineTargetMap[discipline] || [];
      targetsForDiscipline.forEach(t => validTargets.add(t));
    }

    // Check if any target is invalid
    const invalidTargets = targets.filter(t => !validTargets.has(t));
    
    if (invalidTargets.length > 0) {
      const disciplineNames = {
        A: 'Architectural',
        P: 'Plumbing',
        M: 'Mechanical',
        E: 'Electrical'
      };
      
      const selectedNames = disciplines.map(d => disciplineNames[d] || d).join(', ');
      
      throw new BadRequestException(
        `Invalid targets for selected disciplines. ` +
        `Selected disciplines: [${selectedNames}]. ` +
        `Invalid targets: [${invalidTargets.join(', ')}]. ` +
        `Valid targets for your disciplines: [${Array.from(validTargets).join(', ')}].`
      );
    }
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth("JWT-auth")
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: "Start an analysis job",
    description: "Create a new job to analyze uploaded plan files",
  })
  @ApiResponse({
    status: 201,
    description: "Job created successfully",
    type: CreateJobResponse,
  })
  @ApiResponse({
    status: 400,
    description: "Invalid request data",
  })
  async createJob(
    @Body() createJobDto: CreateJobRequest
  ): Promise<CreateJobResponse> {
    // Validate disciplines and targets mapping
    this.validateDisciplinesAndTargets(
      createJobDto.disciplines, 
      createJobDto.targets
    );
    
    return this.jobsService.createJob(createJobDto);
  }

  @Get(":jobId")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({
    summary: "Get job status",
    description: "Get the current status and progress of an analysis job",
  })
  @ApiResponse({
    status: 200,
    description: "Job status retrieved successfully",
    schema: {
      type: "object",
      properties: {
        jobId: { type: "string" },
        status: { type: "string" },
        progress: { type: "number" },
        error: { type: "string" },
        startedAt: { type: "string", format: "date-time" },
        finishedAt: { type: "string", format: "date-time" },
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: "Job not found",
  })
  async getJobStatus(
    @Param("jobId") jobId: string
  ): Promise<JobStatusResponse> {
    return this.jobsService.getJobStatus(jobId);
  }

  @Delete(":jobId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: "Cancel a job",
    description:
      "Cancel a specific analysis job. Only QUEUED and PROCESSING jobs can be cancelled.",
  })
  @ApiResponse({
    status: 204,
    description: "Job cancelled successfully",
  })
  @ApiResponse({
    status: 404,
    description: "Job not found",
  })
  @ApiResponse({
    status: 400,
    description: "Cannot cancel completed or failed job",
  })
  async cancelJob(@Param("jobId") jobId: string): Promise<void> {
    return this.jobsService.cancelJob(jobId);
  }

  @Delete()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Clear all running jobs",
    description:
      "Stop and delete all running, queued, and active jobs from both the queue and database. This will permanently delete all QUEUED and PROCESSING jobs (cascade deletes related sheets, features, and materials).",
  })
  @ApiResponse({
    status: 200,
    description: "All jobs cleared successfully",
    schema: {
      type: "object",
      properties: {
        queueJobsRemoved: {
          type: "number",
          description: "Number of jobs removed from queue",
        },
        databaseJobsDeleted: {
          type: "number",
          description: "Number of jobs deleted from database",
        },
      },
    },
  })
  async clearAllJobs(): Promise<{
    queueJobsRemoved: number;
    databaseJobsDeleted: number;
  }> {
    return this.jobsService.clearAllJobs();
  }

  @Post("process-queued")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth("JWT-auth")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Process queued jobs",
    description:
      "Manually trigger processing of all queued jobs. Useful when Redis is not available or to retry failed queue processing.",
  })
  @ApiResponse({
    status: 200,
    description: "Queued jobs processing started",
    schema: {
      type: "object",
      properties: {
        jobsProcessed: {
          type: "number",
          description: "Number of queued jobs that will be processed",
        },
      },
    },
  })
  async processQueuedJobs(): Promise<{ jobsProcessed: number }> {
    const count = await this.jobsService.processQueuedJobs();
    return { jobsProcessed: count };
  }
}
