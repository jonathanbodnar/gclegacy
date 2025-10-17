import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';

import { ArtifactsService, ArtifactsResponse } from './artifacts.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('Artifacts')
@Controller('artifacts')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('JWT-auth')
export class ArtifactsController {
  constructor(private readonly artifactsService: ArtifactsService) {}

  @Get(':jobId')
  @ApiOperation({ 
    summary: 'Get signed URLs to artifacts',
    description: 'Get signed URLs for overlay images, vector files, and reports generated during analysis'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Artifacts URLs retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        jobId: { type: 'string', example: 'job_789' },
        overlays: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              sheetId: { type: 'string', example: 'A-1.1' },
              type: { type: 'string', example: 'rooms' },
              url: { type: 'string', example: 'https://.../A-1.1.rooms.png?signature=...' },
              description: { type: 'string', example: 'rooms overlay for Floor Plan' }
            }
          }
        },
        vectors: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              sheetId: { type: 'string', example: 'A-1.1' },
              format: { type: 'string', example: 'geojson' },
              url: { type: 'string', example: 'https://.../A-1.1.geojson?signature=...' },
              description: { type: 'string', example: 'GeoJSON vector data for Floor Plan' }
            }
          }
        },
        reports: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', example: 'takeoff-summary' },
              format: { type: 'string', example: 'pdf' },
              url: { type: 'string', example: 'https://.../takeoff-summary.pdf?signature=...' },
              description: { type: 'string', example: 'Comprehensive takeoff summary report' }
            }
          }
        },
        meta: {
          type: 'object',
          properties: {
            generatedAt: { type: 'string', format: 'date-time' },
            expiresAt: { type: 'string', format: 'date-time' }
          }
        }
      }
    }
  })
  @ApiResponse({ 
    status: 404, 
    description: 'Job not found' 
  })
  async getArtifacts(@Param('jobId') jobId: string): Promise<ArtifactsResponse> {
    return this.artifactsService.getArtifacts(jobId);
  }
}
