import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/common/prisma/prisma.service';

export interface ConsistencyIssue {
  type: 'duplicate' | 'conflict' | 'missing' | 'scale_mismatch';
  severity: 'error' | 'warning' | 'info';
  message: string;
  affectedSheets: string[];
  affectedFeatures?: string[];
  details?: any;
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
    this.logger.log(`Checking consistency for job ${jobId}`);

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
    for (const [roomName, roomFeatures] of roomMap.entries()) {
      if (roomFeatures.length > 1) {
        const sheetIds = roomFeatures
          .map((f) => f.sheetId)
          .filter((id) => id !== null);
        const uniqueSheets = Array.from(new Set(sheetIds));

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
    for (const [roomName, roomMap] of roomData.entries()) {
      if (roomMap.size > 1) {
        const rooms = Array.from(roomMap.values());
        const areas = rooms
          .map((r) => r.area)
          .filter((a) => a !== null && a !== undefined);
        const heights = rooms
          .map((r) => r.props?.heightFt || r.heightFt)
          .filter((h) => h !== null && h !== undefined);

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
              affectedSheets: Array.from(roomMap.keys()),
              affectedFeatures: rooms.map((r) => r.id),
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
              affectedSheets: Array.from(roomMap.keys()),
              affectedFeatures: rooms.map((r) => r.id),
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
}

