import { SheetModel } from '../../models/sheet.model';
import { FeatureModel } from '../../models/feature.model';
import { logger as appLogger } from '../../utils/logger';

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

const scopedLogger = (scope: string) => ({
  info: (message: string, payload?: unknown) => appLogger.info(`[${scope}] ${message}`, payload),
  warn: (message: string, payload?: unknown) => appLogger.warn(`[${scope}] ${message}`, payload),
  error: (message: string, payload?: unknown) => appLogger.error(`[${scope}] ${message}`, payload),
});

export class ConsistencyCheckerService {
  private readonly logger = scopedLogger('ConsistencyCheckerService');

  async checkConsistency(jobId: string): Promise<ConsistencyReport> {
    const [sheets, features] = await Promise.all([
      SheetModel.find({ job: jobId }).lean().exec(),
      FeatureModel.find({ job: jobId }).lean().exec(),
    ]);

    const issues: ConsistencyIssue[] = [];
    issues.push(...this.checkDuplicates(features));
    issues.push(...this.checkScaleConsistency(sheets));
    issues.push(...this.checkRoomConflicts(features));
    issues.push(...this.checkMissingReferences(features));

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

  private checkDuplicates(features: any[]): ConsistencyIssue[] {
    const issues: ConsistencyIssue[] = [];
    const roomMap = new Map<string, any[]>();

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

    for (const [roomName, roomFeatures] of roomMap.entries()) {
      if (roomFeatures.length > 1) {
        const sheetIds = roomFeatures
          .map((f) => (f.sheet ? f.sheet.toString() : null))
          .filter(Boolean) as string[];
        const uniqueSheets = Array.from(new Set(sheetIds));
        if (uniqueSheets.length > 1) {
          issues.push({
            type: 'duplicate',
            severity: 'warning',
            message: `Room "${roomName}" appears on ${uniqueSheets.length} different sheets`,
            affectedSheets: uniqueSheets,
            affectedFeatures: roomFeatures.map((f) => f._id?.toString() || ''),
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

  private checkScaleConsistency(sheets: any[]): ConsistencyIssue[] {
    const issues: ConsistencyIssue[] = [];
    const scales = new Map<string, string[]>();

    for (const sheet of sheets) {
      if (sheet.scale) {
        const scaleKey = `${sheet.scale}_${sheet.units || 'ft'}`;
        if (!scales.has(scaleKey)) {
          scales.set(scaleKey, []);
        }
        scales.get(scaleKey)!.push(sheet._id?.toString() || '');
      }
    }

    if (scales.size > 1) {
      const scaleEntries = Array.from(scales.entries());
      issues.push({
        type: 'scale_mismatch',
        severity: 'warning',
        message: `Multiple scales detected across sheets: ${scaleEntries.map(([scale]) => scale).join(', ')}`,
        affectedSheets: scaleEntries.flatMap(([, ids]) => ids),
        details: {
          scales: scaleEntries.map(([scale, ids]) => ({ scale, sheetCount: ids.length })),
        },
      });
    }

    const sheetsWithoutScale = sheets.filter((s) => !s.scale).map((s) => s._id?.toString() || '');
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

  private checkRoomConflicts(features: any[]): ConsistencyIssue[] {
    const issues: ConsistencyIssue[] = [];
    const roomData = new Map<string, Map<string, any>>();

    for (const feature of features) {
      if (feature.type === 'ROOM') {
        const roomName = feature.props?.name || feature.props?.program;
        if (roomName) {
          if (!roomData.has(roomName)) {
            roomData.set(roomName, new Map());
          }
          const roomMap = roomData.get(roomName)!;
          const sheetId = feature.sheet ? feature.sheet.toString() : 'unknown';
          roomMap.set(sheetId, feature);
        }
      }
    }

    for (const [roomName, roomMap] of roomData.entries()) {
      if (roomMap.size > 1) {
        const rooms = Array.from(roomMap.values());
        const areas = rooms
          .map((r) => r.area)
          .filter((a) => a !== null && a !== undefined);
        if (areas.length > 1) {
          const minArea = Math.min(...areas);
          const maxArea = Math.max(...areas);
          const diffPercent = ((maxArea - minArea) / Math.max(minArea, 1)) * 100;
          if (diffPercent > 20) {
            issues.push({
              type: 'conflict',
              severity: 'warning',
              message: `Room "${roomName}" has conflicting area values (${minArea.toFixed(
                1,
              )} - ${maxArea.toFixed(1)} sq ft, ${diffPercent.toFixed(1)}% difference)`,
              affectedSheets: Array.from(roomMap.keys()),
              affectedFeatures: rooms.map((r) => r._id?.toString() || ''),
              details: {
                roomName,
                areas,
                diffPercent: diffPercent.toFixed(1),
              },
            });
          }
        }
      }
    }

    return issues;
  }

  private checkMissingReferences(features: any[]): ConsistencyIssue[] {
    const issues: ConsistencyIssue[] = [];
    const roomNames = new Set<string>();

    for (const feature of features) {
      if (feature.type === 'ROOM') {
        const roomName = feature.props?.name || feature.props?.program;
        if (roomName) {
          roomNames.add(roomName);
        }
      }
    }

    for (const feature of features) {
      if (['PIPE', 'DUCT', 'FIXTURE'].includes(feature.type)) {
        const referencedRoom = feature.props?.roomName || feature.props?.room;
        if (referencedRoom && !roomNames.has(referencedRoom)) {
          issues.push({
            type: 'missing',
            severity: 'warning',
            message: `${feature.type} references room "${referencedRoom}" which was not found`,
            affectedSheets: feature.sheet ? [feature.sheet.toString()] : [],
            affectedFeatures: [feature._id?.toString() || ''],
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
}

