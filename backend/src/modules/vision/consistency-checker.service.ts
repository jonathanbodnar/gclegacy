import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { DocumentContext } from './document-context.service';
import { VisionAnalysisResult } from './openai-vision.service';

export interface ConsistencyIssue {
  type: 'duplicate' | 'conflict' | 'missing' | 'scale_mismatch' | 'orphan' | 'mismatch';
  severity: 'error' | 'warning' | 'info';
  message: string;
  affectedSheets: string[];
  affectedFeatures?: string[];
  details?: any;
}

// Types for pre-database aggregation (used during vision analysis)
export interface AggregatedResults {
  rooms: Map<string, AggregatedRoom>;
  walls: AggregatedWall[];
  pipes: AggregatedPipe[];
  ducts: AggregatedDuct[];
  fixtures: Map<string, AggregatedFixture>;
  totalsByPage: PageTotals[];
}

interface AggregatedRoom {
  id: string;
  name: string;
  area?: number;
  foundOnPages: number[];
  partitionTypes: string[];
}

interface AggregatedWall {
  id: string;
  partitionType?: string;
  length: number;
  pageIndex: number;
}

interface AggregatedPipe {
  id: string;
  service: string;
  diameter?: number;
  length: number;
  pageIndex: number;
}

interface AggregatedDuct {
  id: string;
  size?: string;
  length: number;
  pageIndex: number;
}

interface AggregatedFixture {
  type: string;
  totalCount: number;
  byPage: { pageIndex: number; count: number }[];
}

interface PageTotals {
  pageIndex: number;
  sheetTitle?: string;
  rooms: number;
  walls: number;
  pipes: number;
  ducts: number;
  fixtures: number;
}

export interface ConsistencyReport {
  isValid: boolean;
  issues: ConsistencyIssue[];
  summary: {
    totalIssues: number;
    errors: number;
    warnings: number;
    duplicates: number;
    conflicts: number;
    scaleMismatches: number;
  };
}

@Injectable()
export class ConsistencyCheckerService {
  private readonly logger = new Logger(ConsistencyCheckerService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Check consistency across all sheets for a job
   */
  async checkConsistency(jobId: string): Promise<ConsistencyReport> {
    // Only log in development to reduce log volume
    if (process.env.NODE_ENV !== 'production') {
      this.logger.log(`Checking consistency for job ${jobId}`);
    }

    const issues: ConsistencyIssue[] = [];

    // Get all sheets and features for this job
    const sheets = await this.prisma.sheet.findMany({
      where: { jobId },
      include: {
        features: true,
      },
    });

    const features = await this.prisma.feature.findMany({
      where: { jobId },
    });

    // Check for duplicate features across sheets
    issues.push(...this.checkDuplicates(features, sheets));

    // Check for scale consistency
    issues.push(...this.checkScaleConsistency(sheets));

    // Check for conflicting room names/numbers
    issues.push(...this.checkRoomConflicts(features, sheets));

    // Check for missing cross-references
    issues.push(...this.checkMissingReferences(features, sheets));

    const errors = issues.filter((i) => i.severity === 'error').length;
    const warnings = issues.filter((i) => i.severity === 'warning').length;
    const duplicates = issues.filter((i) => i.type === 'duplicate').length;
    const conflicts = issues.filter((i) => i.type === 'conflict').length;
    const scaleMismatches = issues.filter((i) => i.type === 'scale_mismatch').length;

    return {
      isValid: errors === 0,
      issues,
      summary: {
        totalIssues: issues.length,
        errors,
        warnings,
        duplicates,
        conflicts,
        scaleMismatches,
      },
    };
  }

  /**
   * Check for duplicate features (same room name/number on different sheets)
   */
  private checkDuplicates(
    features: any[],
    sheets: any[]
  ): ConsistencyIssue[] {
    const issues: ConsistencyIssue[] = [];
    const roomMap = new Map<string, any[]>();

    // Group rooms by name
    for (const feature of features) {
      if (feature.type === 'ROOM') {
        const roomName = feature.props?.name || feature.props?.program;
        if (roomName) {
          if (!roomMap.has(roomName)) {
            roomMap.set(roomName, []);
          }
          roomMap.get(roomName)!.push(feature);
        }
      }
    }

    // Check for duplicates
    for (const [roomName, roomFeatures] of Array.from(roomMap.entries())) {
      if (roomFeatures.length > 1) {
        const sheetIds = roomFeatures
          .map((f: any) => f.sheetId)
          .filter((id: any) => id !== null) as string[];
        const uniqueSheets = Array.from(new Set(sheetIds)) as string[];

        if (uniqueSheets.length > 1) {
          issues.push({
            type: 'duplicate',
            severity: 'warning',
            message: `Room "${roomName}" appears on ${uniqueSheets.length} different sheets`,
            affectedSheets: uniqueSheets,
            affectedFeatures: roomFeatures.map((f) => f.id),
            details: {
              roomName,
              occurrences: roomFeatures.length,
            },
          });
        }
      }
    }

    return issues;
  }

  /**
   * Check for scale consistency across sheets
   */
  private checkScaleConsistency(sheets: any[]): ConsistencyIssue[] {
    const issues: ConsistencyIssue[] = [];
    const scales = new Map<string, string[]>();

    for (const sheet of sheets) {
      if (sheet.scale) {
        const scaleKey = `${sheet.scale}_${sheet.units || 'ft'}`;
        if (!scales.has(scaleKey)) {
          scales.set(scaleKey, []);
        }
        scales.get(scaleKey)!.push(sheet.id);
      }
    }

    // If we have multiple different scales, that's a warning
    if (scales.size > 1) {
      const scaleEntries = Array.from(scales.entries());
      issues.push({
        type: 'scale_mismatch',
        severity: 'warning',
        message: `Multiple scales detected across sheets: ${scaleEntries.map(([scale]) => scale).join(', ')}`,
        affectedSheets: scaleEntries.flatMap(([, sheetIds]) => sheetIds),
        details: {
          scales: scaleEntries.map(([scale, sheetIds]) => ({
            scale,
            sheetCount: sheetIds.length,
          })),
        },
      });
    }

    // Check for sheets without scale
    const sheetsWithoutScale = sheets.filter((s) => !s.scale).map((s) => s.id);
    if (sheetsWithoutScale.length > 0) {
      issues.push({
        type: 'scale_mismatch',
        severity: 'warning',
        message: `${sheetsWithoutScale.length} sheet(s) missing scale information`,
        affectedSheets: sheetsWithoutScale,
      });
    }

    return issues;
  }

  /**
   * Check for conflicting room information
   */
  private checkRoomConflicts(
    features: any[],
    sheets: any[]
  ): ConsistencyIssue[] {
    const issues: ConsistencyIssue[] = [];
    const roomData = new Map<string, Map<string, any>>();

    // Group room data by name
    for (const feature of features) {
      if (feature.type === 'ROOM') {
        const roomName = feature.props?.name || feature.props?.program;
        if (roomName) {
          if (!roomData.has(roomName)) {
            roomData.set(roomName, new Map());
          }
          const roomMap = roomData.get(roomName)!;
          const sheetId = feature.sheetId || 'unknown';
          roomMap.set(sheetId, feature);
        }
      }
    }

    // Check for conflicts (same room name with different areas/heights)
    for (const [roomName, roomMapEntry] of Array.from(roomData.entries())) {
      if (roomMapEntry.size > 1) {
        const rooms = Array.from(roomMapEntry.values()) as any[];
        const areas = rooms
          .map((r: any) => r.area)
          .filter((a: any) => a !== null && a !== undefined);
        const heights = rooms
          .map((r: any) => r.props?.heightFt || r.heightFt)
          .filter((h: any) => h !== null && h !== undefined);

        // Check for area conflicts (>20% difference)
        if (areas.length > 1) {
          const minArea = Math.min(...areas);
          const maxArea = Math.max(...areas);
          const diffPercent = ((maxArea - minArea) / minArea) * 100;
          if (diffPercent > 20) {
            issues.push({
              type: 'conflict',
              severity: 'warning',
              message: `Room "${roomName}" has conflicting area values (${minArea.toFixed(1)} - ${maxArea.toFixed(1)} sq ft, ${diffPercent.toFixed(1)}% difference)`,
              affectedSheets: Array.from(roomMapEntry.keys()) as string[],
              affectedFeatures: rooms.map((r: any) => r.id),
              details: {
                roomName,
                areas,
                diffPercent: diffPercent.toFixed(1),
              },
            });
          }
        }

        // Check for height conflicts (>2 ft difference)
        if (heights.length > 1) {
          const minHeight = Math.min(...heights);
          const maxHeight = Math.max(...heights);
          if (maxHeight - minHeight > 2) {
            issues.push({
              type: 'conflict',
              severity: 'info',
              message: `Room "${roomName}" has conflicting height values (${minHeight} - ${maxHeight} ft)`,
              affectedSheets: Array.from(roomMapEntry.keys()) as string[],
              affectedFeatures: rooms.map((r: any) => r.id),
              details: {
                roomName,
                heights,
              },
            });
          }
        }
      }
    }

    return issues;
  }

  /**
   * Check for missing cross-references (e.g., pipe references a room that doesn't exist)
   */
  private checkMissingReferences(
    features: any[],
    sheets: any[]
  ): ConsistencyIssue[] {
    const issues: ConsistencyIssue[] = [];
    const roomNames = new Set<string>();

    // Collect all room names
    for (const feature of features) {
      if (feature.type === 'ROOM') {
        const roomName = feature.props?.name || feature.props?.program;
        if (roomName) {
          roomNames.add(roomName);
        }
      }
    }

    // Check if other features reference rooms that don't exist
    for (const feature of features) {
      if (feature.type === 'PIPE' || feature.type === 'DUCT' || feature.type === 'FIXTURE') {
        const referencedRoom = feature.props?.roomName || feature.props?.room;
        if (referencedRoom && !roomNames.has(referencedRoom)) {
          issues.push({
            type: 'missing',
            severity: 'warning',
            message: `${feature.type} references room "${referencedRoom}" which was not found`,
            affectedSheets: feature.sheetId ? [feature.sheetId] : [],
            affectedFeatures: [feature.id],
            details: {
              featureType: feature.type,
              referencedRoom,
            },
          });
        }
      }
    }

    return issues;
  }

  /**
   * Validate a single feature against existing features
   */
  async validateFeatureConsistency(
    jobId: string,
    newFeature: any
  ): Promise<ConsistencyIssue[]> {
    const issues: ConsistencyIssue[] = [];

    // Get existing features
    const existingFeatures = await this.prisma.feature.findMany({
      where: { jobId },
    });

    // Check for duplicate room names
    if (newFeature.type === 'ROOM') {
      const roomName = newFeature.props?.name || newFeature.props?.program;
      if (roomName) {
        const duplicates = existingFeatures.filter(
          (f) =>
            f.type === 'ROOM' &&
            (f.props as any)?.name === roomName &&
            f.id !== newFeature.id
        );
        if (duplicates.length > 0) {
          issues.push({
            type: 'duplicate',
            severity: 'warning',
            message: `Room "${roomName}" already exists on another sheet`,
            affectedSheets: duplicates
              .map((d) => d.sheetId)
              .filter((id) => id !== null),
            affectedFeatures: duplicates.map((d) => d.id),
          });
        }
      }
    }

    return issues;
  }

  // ============================================================================
  // PRE-DATABASE AGGREGATION METHODS
  // Used during vision analysis to aggregate and deduplicate results before saving
  // ============================================================================

  /**
   * Aggregate and deduplicate results from multiple pages (pre-database)
   */
  aggregateVisionResults(
    pageResults: Array<{ pageIndex: number; features: VisionAnalysisResult }>,
    documentContext?: DocumentContext
  ): AggregatedResults {
    const aggregated: AggregatedResults = {
      rooms: new Map(),
      walls: [],
      pipes: [],
      ducts: [],
      fixtures: new Map(),
      totalsByPage: [],
    };

    for (const { pageIndex, features } of pageResults) {
      // Track page totals
      const pageTotals: PageTotals = {
        pageIndex,
        sheetTitle: features.sheetTitle,
        rooms: features.rooms?.length || 0,
        walls: features.walls?.length || 0,
        pipes: features.pipes?.length || 0,
        ducts: features.ducts?.length || 0,
        fixtures: features.fixtures?.reduce((sum, f) => sum + (f.count || 0), 0) || 0,
      };
      aggregated.totalsByPage.push(pageTotals);

      // Aggregate rooms (deduplicate by room number/name)
      for (const room of features.rooms || []) {
        const key = this.normalizeRoomKey(room.name || room.id);
        const existing = aggregated.rooms.get(key);
        
        if (existing) {
          existing.foundOnPages.push(pageIndex);
          if (room.area && (!existing.area || room.area > existing.area)) {
            existing.area = room.area;
          }
        } else {
          aggregated.rooms.set(key, {
            id: room.id || key,
            name: room.name || key,
            area: room.area,
            foundOnPages: [pageIndex],
            partitionTypes: [],
          });
        }
      }

      // Aggregate walls (don't deduplicate - different pages have different walls)
      for (const wall of features.walls || []) {
        if (wall.length && wall.length > 0) {
          aggregated.walls.push({
            id: wall.id || `wall_${pageIndex}_${aggregated.walls.length}`,
            partitionType: wall.partitionType,
            length: wall.length,
            pageIndex,
          });
        }
      }

      // Aggregate pipes
      for (const pipe of features.pipes || []) {
        if (pipe.length && pipe.length > 0) {
          aggregated.pipes.push({
            id: pipe.id || `pipe_${pageIndex}_${aggregated.pipes.length}`,
            service: pipe.service || 'CW',
            diameter: pipe.diameter,
            length: pipe.length,
            pageIndex,
          });
        }
      }

      // Aggregate ducts
      for (const duct of features.ducts || []) {
        if (duct.length && duct.length > 0) {
          aggregated.ducts.push({
            id: duct.id || `duct_${pageIndex}_${aggregated.ducts.length}`,
            size: duct.size,
            length: duct.length,
            pageIndex,
          });
        }
      }

      // Aggregate fixtures (group by type)
      for (const fixture of features.fixtures || []) {
        const type = this.normalizeFixtureType(fixture.type);
        const existing = aggregated.fixtures.get(type);
        
        if (existing) {
          existing.totalCount += fixture.count || 0;
          existing.byPage.push({ pageIndex, count: fixture.count || 0 });
        } else {
          aggregated.fixtures.set(type, {
            type,
            totalCount: fixture.count || 0,
            byPage: [{ pageIndex, count: fixture.count || 0 }],
          });
        }
      }
    }

    return aggregated;
  }

  /**
   * Validate aggregated results against document context
   */
  validateAgainstContext(
    aggregated: AggregatedResults,
    documentContext?: DocumentContext
  ): ConsistencyIssue[] {
    const issues: ConsistencyIssue[] = [];

    if (documentContext) {
      // Check for rooms in schedule but not found in drawings
      for (const scheduleRoom of documentContext.roomSchedule || []) {
        const key = this.normalizeRoomKey(scheduleRoom.roomNumber || scheduleRoom.roomName);
        if (!aggregated.rooms.has(key)) {
          issues.push({
            type: 'missing',
            severity: 'warning',
            message: `Room "${scheduleRoom.roomNumber}: ${scheduleRoom.roomName}" listed in schedule but not found`,
            affectedSheets: [],
          });
        }
      }

      // Check for unknown partition types
      const knownTypes = new Set((documentContext.partitionTypes || []).map(pt => pt.id.toUpperCase()));
      const usedTypes = new Set(aggregated.walls.map(w => w.partitionType?.toUpperCase()).filter(Boolean));
      
      for (const pt of usedTypes) {
        if (pt && !knownTypes.has(pt) && knownTypes.size > 0) {
          issues.push({
            type: 'mismatch',
            severity: 'info',
            message: `Partition type "${pt}" used but not in legend`,
            affectedSheets: [],
          });
        }
      }
    }

    // Check for rooms appearing on too many pages (likely duplicates)
    for (const [key, room] of aggregated.rooms) {
      if (room.foundOnPages.length > 3) {
        issues.push({
          type: 'duplicate',
          severity: 'info',
          message: `Room "${room.name}" found on ${room.foundOnPages.length} pages`,
          affectedSheets: room.foundOnPages.map(String),
        });
      }
    }

    return issues;
  }

  /**
   * Generate validated summary with deduplicated totals
   */
  generateValidatedSummary(aggregated: AggregatedResults): {
    totalRooms: number;
    totalWallLength: number;
    totalPipeLength: number;
    totalDuctLength: number;
    totalFixtures: number;
    fixtureBreakdown: { type: string; count: number }[];
    pipeBreakdown: { service: string; length: number }[];
    wallBreakdown: { partitionType: string; length: number }[];
  } {
    const wallByType = new Map<string, number>();
    for (const wall of aggregated.walls) {
      const type = wall.partitionType || 'UNSPECIFIED';
      wallByType.set(type, (wallByType.get(type) || 0) + wall.length);
    }

    const pipeByService = new Map<string, number>();
    for (const pipe of aggregated.pipes) {
      const service = pipe.service || 'OTHER';
      pipeByService.set(service, (pipeByService.get(service) || 0) + pipe.length);
    }

    const fixtureBreakdown = Array.from(aggregated.fixtures.values()).map(f => ({
      type: f.type,
      count: f.totalCount,
    }));

    return {
      totalRooms: aggregated.rooms.size,
      totalWallLength: aggregated.walls.reduce((sum, w) => sum + w.length, 0),
      totalPipeLength: aggregated.pipes.reduce((sum, p) => sum + p.length, 0),
      totalDuctLength: aggregated.ducts.reduce((sum, d) => sum + d.length, 0),
      totalFixtures: Array.from(aggregated.fixtures.values()).reduce((sum, f) => sum + f.totalCount, 0),
      fixtureBreakdown,
      pipeBreakdown: Array.from(pipeByService.entries()).map(([service, length]) => ({ service, length })),
      wallBreakdown: Array.from(wallByType.entries()).map(([partitionType, length]) => ({ partitionType, length })),
    };
  }

  private normalizeRoomKey(name: string): string {
    if (!name) return 'UNKNOWN';
    return name.toString().trim().toUpperCase().replace(/\s+/g, ' ');
  }

  private normalizeFixtureType(type: string): string {
    if (!type) return 'OTHER';
    const normalized = type.toLowerCase().trim();
    
    const typeMap: Record<string, string> = {
      'water closet': 'TOILET',
      'wc': 'TOILET',
      'toilet': 'TOILET',
      'lavatory': 'SINK',
      'lav': 'SINK',
      'sink': 'SINK',
      'urinal': 'URINAL',
      'floor drain': 'FLOOR_DRAIN',
      'fd': 'FLOOR_DRAIN',
      'light': 'LIGHT',
      'light fixture': 'LIGHT',
      'outlet': 'OUTLET',
      'receptacle': 'OUTLET',
      'switch': 'SWITCH',
    };

    return typeMap[normalized] || type.toUpperCase().replace(/\s+/g, '_');
  }
}

