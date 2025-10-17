import { Controller, Get, Param, UseGuards, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery, ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';

import { TakeoffService, TakeoffResponse } from './takeoff.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

class PaginationQuery {
  @ApiProperty({ required: false, minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiProperty({ required: false, minimum: 1, maximum: 1000, default: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 100;
}

@ApiTags('Takeoff')
@Controller('takeoff')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('JWT-auth')
export class TakeoffController {
  constructor(private readonly takeoffService: TakeoffService) {}

  @Get(':jobId')
  @ApiOperation({ 
    summary: 'Get normalized takeoff graph',
    description: 'Retrieve the complete takeoff analysis results for a job'
  })
  @ApiQuery({ 
    name: 'page', 
    required: false, 
    type: Number,
    description: 'Page number for pagination (if results are large)'
  })
  @ApiQuery({ 
    name: 'limit', 
    required: false, 
    type: Number,
    description: 'Number of items per page'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Takeoff data retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        version: { type: 'string', example: '2025-10-01' },
        units: {
          type: 'object',
          properties: {
            linear: { type: 'string', example: 'ft' },
            area: { type: 'string', example: 'ft2' }
          }
        },
        sheets: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', example: 'A-1.1' },
              scale: { type: 'string', example: '1/4"=1\'-0"' }
            }
          }
        },
        rooms: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', example: 'R100' },
              name: { type: 'string', example: 'SALES AREA' },
              area: { type: 'number', example: 1265.0 }
            }
          }
        },
        walls: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', example: 'W12' },
              length: { type: 'number', example: 36.2 },
              partitionType: { type: 'string', example: 'PT-1' }
            }
          }
        },
        openings: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', example: 'D3' },
              type: { type: 'string', example: 'door' },
              width: { type: 'number', example: 3.0 }
            }
          }
        },
        pipes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', example: 'P22' },
              service: { type: 'string', example: 'CW' },
              diameterIn: { type: 'number', example: 1.0 },
              length: { type: 'number', example: 88.5 }
            }
          }
        },
        ducts: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', example: 'DCT9' },
              size: { type: 'string', example: '12x10' },
              length: { type: 'number', example: 120.0 }
            }
          }
        },
        fixtures: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', example: 'L-100' },
              type: { type: 'string', example: 'FD2' },
              count: { type: 'number', example: 25 }
            }
          }
        },
        meta: {
          type: 'object',
          properties: {
            fileId: { type: 'string', example: 'file_123' },
            jobId: { type: 'string', example: 'job_789' }
          }
        }
      }
    }
  })
  @ApiResponse({ 
    status: 404, 
    description: 'Job not found' 
  })
  async getTakeoff(
    @Param('jobId') jobId: string,
    @Query() pagination: PaginationQuery,
  ): Promise<TakeoffResponse> {
    return this.takeoffService.getTakeoff(jobId);
  }
}
