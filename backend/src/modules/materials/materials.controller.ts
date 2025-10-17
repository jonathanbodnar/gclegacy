import { Controller, Get, Param, UseGuards, Query, Res } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery, ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsIn } from 'class-validator';
import { Response } from 'express';

import { MaterialsService, MaterialsResponse } from './materials.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

class ExportQuery {
  @ApiProperty({ 
    required: false, 
    enum: ['json', 'csv'], 
    default: 'json',
    description: 'Export format'
  })
  @IsOptional()
  @IsIn(['json', 'csv'])
  format?: 'json' | 'csv' = 'json';
}

@ApiTags('Materials')
@Controller('materials')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('JWT-auth')
export class MaterialsController {
  constructor(private readonly materialsService: MaterialsService) {}

  @Get(':jobId')
  @ApiOperation({ 
    summary: 'Get computed materials list',
    description: 'Retrieve the materials bill generated from takeoff analysis and rules'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Materials list retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        jobId: { type: 'string', example: 'job_789' },
        currency: { type: 'string', example: 'USD' },
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              sku: { type: 'string', example: 'STUD-362-20GA' },
              qty: { type: 'number', example: 540.0 },
              uom: { type: 'string', example: 'ea' },
              unitPrice: { type: 'number', example: 8.50 },
              totalPrice: { type: 'number', example: 4590.00 },
              description: { type: 'string', example: '3-5/8" Metal Stud, 20 GA' },
              category: { type: 'string', example: 'Framing & Drywall' },
              source: {
                type: 'object',
                properties: {
                  rule: { type: 'string', example: 'PT-1 studs' },
                  features: { 
                    type: 'array', 
                    items: { type: 'string' },
                    example: ['W12', 'W13', 'W14']
                  }
                }
              }
            }
          }
        },
        summary: {
          type: 'object',
          properties: {
            totalItems: { type: 'number', example: 15 },
            totalValue: { type: 'number', example: 25420.50 },
            generatedAt: { type: 'string', format: 'date-time' }
          }
        }
      }
    }
  })
  @ApiResponse({ 
    status: 404, 
    description: 'Job not found' 
  })
  async getMaterials(@Param('jobId') jobId: string): Promise<MaterialsResponse> {
    return this.materialsService.getMaterials(jobId);
  }

  @Get(':jobId/export')
  @ApiOperation({ 
    summary: 'Export materials list',
    description: 'Export the materials list in JSON or CSV format'
  })
  @ApiQuery({ 
    name: 'format', 
    required: false, 
    enum: ['json', 'csv'],
    description: 'Export format (json or csv)'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Materials exported successfully',
    content: {
      'application/json': {
        schema: { type: 'string' }
      },
      'text/csv': {
        schema: { type: 'string' }
      }
    }
  })
  @ApiResponse({ 
    status: 404, 
    description: 'Job not found' 
  })
  async exportMaterials(
    @Param('jobId') jobId: string,
    @Query() query: ExportQuery,
    @Res() res: Response,
  ): Promise<void> {
    const format = query.format || 'json';
    const data = await this.materialsService.exportMaterials(jobId, format);
    
    if (format === 'csv') {
      res.set({
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="materials-${jobId}.csv"`,
      });
    } else {
      res.set({
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="materials-${jobId}.json"`,
      });
    }
    
    res.send(data);
  }
}
