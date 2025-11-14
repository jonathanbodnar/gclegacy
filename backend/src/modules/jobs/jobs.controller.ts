import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiProperty } from '@nestjs/swagger';
import { IsString, IsArray, IsOptional, IsBoolean } from 'class-validator';

import { JobsService, CreateJobDto, JobStatusResponse } from './jobs.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

class CreateJobRequest {
  @ApiProperty({ example: 'file_abc123' })
  @IsString()
  fileId: string;

  @ApiProperty({ example: ['A', 'P', 'M', 'E'] })
  @IsArray()
  @IsString({ each: true })
  disciplines: string[];

  @ApiProperty({ 
    example: ['rooms', 'walls', 'pipes', 'fixtures', 'vertical'] 
  })
  @IsArray()
  @IsString({ each: true })
  targets: string[];

  @ApiProperty({ required: false, example: 'mrs_001' })
  @IsOptional()
  @IsString()
  materialsRuleSetId?: string;

  @ApiProperty({ required: false, example: 'https://yourapp.com/hooks/plan' })
  @IsOptional()
  @IsString()
  webhookUrl?: string;

  @ApiProperty({ 
    required: false,
    description: 'Optional tuning flags (scale overrides, story heights, sheet metadata).',
    example: {
      inferScale: true,
      defaultStoryHeightFt: 12,
      levelOverrides: {
        'Level 1': 0,
        'Level 2': 12
      }
    }
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
        type?: 'plan' | 'elevation' | 'section';
        defaultStoryHeightFt?: number;
        levels?: string[];
      }
    >;
    [key: string]: any;
  };
}

class CreateJobResponse {
  @ApiProperty({ example: 'job_xyz789' })
  jobId: string;

  @ApiProperty({ example: 'QUEUED' })
  status: string;
}

@ApiTags('Jobs')
@Controller('jobs')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('JWT-auth')
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ 
    summary: 'Start an analysis job',
    description: 'Create a new job to analyze uploaded plan files'
  })
  @ApiResponse({ 
    status: 201, 
    description: 'Job created successfully',
    type: CreateJobResponse
  })
  @ApiResponse({ 
    status: 400, 
    description: 'Invalid request data' 
  })
  async createJob(@Body() createJobDto: CreateJobRequest): Promise<CreateJobResponse> {
    return this.jobsService.createJob(createJobDto);
  }

  @Get(':jobId')
  @ApiOperation({ 
    summary: 'Get job status',
    description: 'Get the current status and progress of an analysis job'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Job status retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        jobId: { type: 'string' },
        status: { type: 'string' },
        progress: { type: 'number' },
        error: { type: 'string' },
        startedAt: { type: 'string', format: 'date-time' },
        finishedAt: { type: 'string', format: 'date-time' }
      }
    }
  })
  @ApiResponse({ 
    status: 404, 
    description: 'Job not found' 
  })
  async getJobStatus(@Param('jobId') jobId: string): Promise<JobStatusResponse> {
    return this.jobsService.getJobStatus(jobId);
  }
}
