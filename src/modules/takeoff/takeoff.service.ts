import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/common/prisma/prisma.service';

export interface TakeoffResponse {
  version: string;
  units: {
    linear: string;
    area: string;
    volume?: string;
  };
  sheets: SheetInfo[];
  rooms: RoomFeature[];
  walls: WallFeature[];
  openings: OpeningFeature[];
  pipes: PipeFeature[];
  ducts: DuctFeature[];
  fixtures: FixtureFeature[];
  meta: {
    fileId: string;
    jobId: string;
    generatedAt: string;
  };
}

export interface SheetInfo {
  id: string;
  scale?: string;
  units?: string;
  discipline?: string;
  name?: string;
}

export interface BaseFeature {
  id: string;
  sheetId?: string;
  type: string;
}

export interface RoomFeature extends BaseFeature {
  name?: string;
  polygon?: number[][];
  area: number;
  program?: string;
}

export interface WallFeature extends BaseFeature {
  polyline?: number[][];
  length: number;
  partitionType?: string;
  height?: number;
}

export interface OpeningFeature extends BaseFeature {
  at?: number[];
  width?: number;
  height?: number;
  openingType: string;
}

export interface PipeFeature extends BaseFeature {
  service: string;
  diameterIn: number;
  length: number;
  polyline?: number[][];
}

export interface DuctFeature extends BaseFeature {
  size: string;
  length: number;
  polyline?: number[][];
  service?: string;
}

export interface FixtureFeature extends BaseFeature {
  fixtureType: string;
  count: number;
  at?: number[];
  service?: string;
}

@Injectable()
export class TakeoffService {
  constructor(private prisma: PrismaService) {}

  async getTakeoff(jobId: string): Promise<TakeoffResponse> {
    // Verify job exists and is completed
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      include: {
        file: true,
        sheets: true,
        features: true,
      },
    });

    if (!job) {
      throw new NotFoundException('Job not found');
    }

    // Get sheets information
    const sheets: SheetInfo[] = job.sheets.map(sheet => ({
      id: sheet.id,
      scale: sheet.scale,
      units: sheet.units,
      discipline: sheet.discipline,
      name: sheet.name,
    }));

    // Group features by type
    const featuresByType = this.groupFeaturesByType(job.features);

    // Determine units (use first sheet's units or default)
    const units = {
      linear: job.sheets[0]?.units || 'ft',
      area: job.sheets[0]?.units === 'm' ? 'm2' : 'ft2',
      volume: job.sheets[0]?.units === 'm' ? 'm3' : 'ft3',
    };

    return {
      version: '2025-10-01',
      units,
      sheets,
      rooms: this.formatRoomFeatures(featuresByType.ROOM || []),
      walls: this.formatWallFeatures(featuresByType.WALL || []),
      openings: this.formatOpeningFeatures(featuresByType.OPENING || []),
      pipes: this.formatPipeFeatures(featuresByType.PIPE || []),
      ducts: this.formatDuctFeatures(featuresByType.DUCT || []),
      fixtures: this.formatFixtureFeatures(featuresByType.FIXTURE || []),
      meta: {
        fileId: job.fileId,
        jobId: job.id,
        generatedAt: new Date().toISOString(),
      },
    };
  }

  private groupFeaturesByType(features: any[]): Record<string, any[]> {
    return features.reduce((groups, feature) => {
      const type = feature.type;
      if (!groups[type]) {
        groups[type] = [];
      }
      groups[type].push(feature);
      return groups;
    }, {});
  }

  private formatRoomFeatures(features: any[]): RoomFeature[] {
    return features.map(feature => ({
      id: feature.id,
      sheetId: feature.sheetId,
      type: 'room',
      name: feature.props?.name,
      area: feature.area || 0,
      program: feature.props?.program,
      // polygon: this.extractGeometry(feature.geom), // Would extract from PostGIS
    }));
  }

  private formatWallFeatures(features: any[]): WallFeature[] {
    return features.map(feature => ({
      id: feature.id,
      sheetId: feature.sheetId,
      type: 'wall',
      length: feature.length || 0,
      partitionType: feature.props?.partitionType,
      height: feature.props?.height,
      // polyline: this.extractGeometry(feature.geom), // Would extract from PostGIS
    }));
  }

  private formatOpeningFeatures(features: any[]): OpeningFeature[] {
    return features.map(feature => ({
      id: feature.id,
      sheetId: feature.sheetId,
      type: 'opening',
      openingType: feature.props?.openingType || feature.props?.type || 'door',
      width: feature.props?.width,
      height: feature.props?.height,
      // at: this.extractPoint(feature.geom), // Would extract from PostGIS
    }));
  }

  private formatPipeFeatures(features: any[]): PipeFeature[] {
    return features.map(feature => ({
      id: feature.id,
      sheetId: feature.sheetId,
      type: 'pipe',
      service: feature.props?.service || 'CW',
      diameterIn: feature.props?.diameterIn || feature.props?.diameter || 1,
      length: feature.length || 0,
      // polyline: this.extractGeometry(feature.geom), // Would extract from PostGIS
    }));
  }

  private formatDuctFeatures(features: any[]): DuctFeature[] {
    return features.map(feature => ({
      id: feature.id,
      sheetId: feature.sheetId,
      type: 'duct',
      size: feature.props?.size || '12x10',
      length: feature.length || 0,
      service: feature.props?.service,
      // polyline: this.extractGeometry(feature.geom), // Would extract from PostGIS
    }));
  }

  private formatFixtureFeatures(features: any[]): FixtureFeature[] {
    return features.map(feature => ({
      id: feature.id,
      sheetId: feature.sheetId,
      type: 'fixture',
      fixtureType: feature.props?.fixtureType || feature.props?.type || 'UNKNOWN',
      count: feature.count || 1,
      service: feature.props?.service,
      // at: this.extractPoint(feature.geom), // Would extract from PostGIS
    }));
  }

  // Placeholder methods for geometry extraction from PostGIS
  // In a real implementation, these would parse the geometry data
  private extractGeometry(geom: any): number[][] {
    // Would extract coordinates from PostGIS geometry
    return [[0, 0], [100, 0], [100, 100], [0, 100]]; // Mock polygon
  }

  private extractPoint(geom: any): number[] {
    // Would extract point coordinates from PostGIS geometry
    return [50, 50]; // Mock point
  }
}
