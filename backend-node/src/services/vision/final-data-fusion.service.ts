import {
  SheetData,
  RoomScheduleEntry,
  RoomSpatialMapping,
  RoomCeilingHeight,
  WallRunSegment,
  PartitionTypeDefinition,
  ScaleAnnotation,
  SpaceDefinition,
} from '../../types/vision';
import { SpaceFinishDefinition } from './materials-extraction.service';
import { config } from '../../config/env';

export interface FusedRoom {
  room_number: string;
  room_name?: string;
  floor_finish_code?: string | null;
  wall_finish_code?: string | null;
  ceiling_finish_code?: string | null;
  base_code?: string | null;
  space_id?: string | null;
  bounding_box_px?: number[] | null;
  label_center_px?: [number, number] | null;
  height_ft?: number | null;
  finishes?: {
    floor?: string | null;
    walls?: (string | null)[];
    ceiling?: string | null;
    base?: string | null;
  };
  notes?: string[];
  sheet_refs?: string[];
}

export interface FusedWall {
  id: string;
  partition_type_id?: string | null;
  new_or_existing?: string | null;
  endpoints_px: [number, number][];
  adjacent_rooms?: (string | null)[];
  adjacent_spaces?: (string | null)[];
  length_px: number;
  length_ft?: number | null;
  notes?: string | null;
}

export interface FusedDataSummary {
  rooms: FusedRoom[];
  walls: FusedWall[];
  meta: {
    partitionTypes?: PartitionTypeDefinition[];
    sheetCount: number;
    scaleAnnotations?: ScaleAnnotation[];
    spaces?: SpaceDefinition[];
    spaceFinishes?: SpaceFinishDefinition[];
  };
}

export class FinalDataFusionService {
  private readonly defaultDpi: number;

  constructor() {
    this.defaultDpi = config.vision.pdfRenderDpi ?? 220;
  }

  fuse(input: {
    sheets: SheetData[];
    roomSchedules?: RoomScheduleEntry[];
    roomSpatialMappings?: RoomSpatialMapping[];
    ceilingHeights?: RoomCeilingHeight[];
    wallRuns?: WallRunSegment[];
    partitionTypes?: PartitionTypeDefinition[];
    scaleAnnotations?: ScaleAnnotation[];
    spaces?: SpaceDefinition[];
    spaceFinishes?: SpaceFinishDefinition[];
  }): FusedDataSummary {
    const sheetsByIndex = new Map<number, SheetData>();
    for (const sheet of input.sheets || []) {
      sheetsByIndex.set(sheet.index, sheet);
    }

    const scaleLookup = this.groupScaleAnnotations(input.scaleAnnotations || []);

    const rooms = this.combineRooms(
      input.roomSchedules || [],
      input.roomSpatialMappings || [],
      input.ceilingHeights || [],
      input.spaces || [],
      input.spaceFinishes || [],
    );
    const walls = this.combineWalls(input.wallRuns || [], sheetsByIndex, scaleLookup);

    return {
      rooms,
      walls,
      meta: {
        partitionTypes: input.partitionTypes || [],
        sheetCount: input.sheets?.length || 0,
        scaleAnnotations: input.scaleAnnotations || [],
        spaces: input.spaces || [],
        spaceFinishes: input.spaceFinishes || [],
      },
    };
  }

  private combineRooms(
    schedules: RoomScheduleEntry[],
    mappings: RoomSpatialMapping[],
    heights: RoomCeilingHeight[],
    spaces: SpaceDefinition[],
    spaceFinishes: SpaceFinishDefinition[],
  ): FusedRoom[] {
    const roomMap = new Map<
      string,
      {
        room: FusedRoom;
        notes: Set<string>;
        sheetRefs: Set<string>;
      }
    >();

    const ensureRoom = (roomNumber: string, roomName?: string | null) => {
      if (!roomMap.has(roomNumber)) {
        roomMap.set(roomNumber, {
          room: {
            room_number: roomNumber,
            room_name: roomName || undefined,
            notes: [],
            sheet_refs: [],
          },
          notes: new Set<string>(),
          sheetRefs: new Set<string>(),
        });
      }
      const entry = roomMap.get(roomNumber)!;
      if (roomName && !entry.room.room_name) {
        entry.room.room_name = roomName;
      }
      return entry;
    };

    for (const schedule of schedules) {
      if (!schedule.room_number) continue;
      const entry = ensureRoom(schedule.room_number, schedule.room_name);
      entry.room.floor_finish_code = schedule.floor_finish_code ?? entry.room.floor_finish_code;
      entry.room.wall_finish_code = schedule.wall_finish_code ?? entry.room.wall_finish_code;
      entry.room.ceiling_finish_code =
        schedule.ceiling_finish_code ?? entry.room.ceiling_finish_code;
      entry.room.base_code = schedule.base_code ?? entry.room.base_code;
      if (schedule.sheetName) {
        entry.sheetRefs.add(schedule.sheetName);
      }
    }

    for (const mapping of mappings) {
      if (!mapping.room_number) continue;
      const entry = ensureRoom(mapping.room_number, mapping.room_name);
      entry.room.bounding_box_px = mapping.bounding_box_px || entry.room.bounding_box_px || null;
      entry.room.label_center_px = mapping.label_center_px || entry.room.label_center_px || null;
      if (mapping.sheetName) {
        entry.sheetRefs.add(mapping.sheetName);
      }
      if (mapping.notes) {
        entry.notes.add(mapping.notes);
      }
    }

    for (const height of heights) {
      if (!height.room_number) continue;
      const entry = ensureRoom(height.room_number);
      entry.room.height_ft = height.height_ft ?? entry.room.height_ft;
      if (height.source_note) entry.notes.add(height.source_note);
      if (height.sheetName) entry.sheetRefs.add(height.sheetName);
    }

    const spaceFinishesByCategory = spaceFinishes.reduce((acc, finish) => {
      acc[finish.category] = finish;
      return acc;
    }, {} as Record<string, SpaceFinishDefinition>);

    for (const space of spaces) {
      const entry = ensureRoom(space.space_id, space.name);
      entry.room.space_id = space.space_id;
      entry.room.bounding_box_px = space.bbox_px || entry.room.bounding_box_px || null;
      if (space.sheetName) {
        entry.sheetRefs.add(space.sheetName);
      }
      const finish = spaceFinishesByCategory[space.category];
      if (finish) {
        entry.room.finishes = {
          floor: finish?.floor || null,
          walls: finish?.walls,
          ceiling: finish?.ceiling || null,
          base: finish?.base || null,
        };
      }
    }

    return Array.from(roomMap.values()).map(({ room, notes, sheetRefs }) => ({
      ...room,
      notes: notes.size ? Array.from(notes) : undefined,
      sheet_refs: sheetRefs.size ? Array.from(sheetRefs) : undefined,
    }));
  }

  private combineWalls(
    wallRuns: WallRunSegment[],
    sheetsByIndex: Map<number, SheetData>,
    scaleLookup: Map<number, ScaleAnnotation[]>,
  ): FusedWall[] {
    return wallRuns.map((segment) => {
      const sheet = sheetsByIndex.get(segment.sheetIndex);
      const lengthPx = this.calculatePolylineLength(segment.endpoints_px);
      const scaleAnnotations = scaleLookup.get(segment.sheetIndex) || [];
      const preferredScale = this.selectScaleAnnotation(scaleAnnotations, sheet);
      const lengthFt = sheet
        ? this.convertPixelsToFeet(lengthPx, sheet, preferredScale)
        : undefined;

      return {
        id: segment.id,
        partition_type_id: segment.partition_type_id || null,
        new_or_existing: segment.new_or_existing || null,
        endpoints_px: segment.endpoints_px,
        adjacent_rooms: segment.adjacent_rooms,
        adjacent_spaces: segment.space_ids,
        length_px: Number(lengthPx.toFixed(2)),
        length_ft: lengthFt !== undefined ? Number(lengthFt.toFixed(2)) : null,
        notes: segment.notes || null,
      };
    });
  }

  private calculatePolylineLength(points: [number, number][]): number {
    if (!Array.isArray(points) || points.length < 2) {
      return 0;
    }
    let total = 0;
    for (let i = 1; i < points.length; i += 1) {
      const [x1, y1] = points[i - 1];
      const [x2, y2] = points[i];
      const dx = x2 - x1;
      const dy = y2 - y1;
      total += Math.sqrt(dx * dx + dy * dy);
    }
    return total;
  }

  private groupScaleAnnotations(annotations: ScaleAnnotation[]): Map<number, ScaleAnnotation[]> {
    const lookup = new Map<number, ScaleAnnotation[]>();
    for (const annotation of annotations) {
      if (!lookup.has(annotation.sheetIndex)) {
        lookup.set(annotation.sheetIndex, []);
      }
      lookup.get(annotation.sheetIndex)!.push(annotation);
    }
    return lookup;
  }

  private selectScaleAnnotation(
    annotations: ScaleAnnotation[],
    sheet?: SheetData,
  ): ScaleAnnotation | undefined {
    if (!annotations.length) return undefined;
    const category = sheet?.classification?.category;
    const lowerCategory = category ? category.toLowerCase() : '';

    const priority = (annotation: ScaleAnnotation) => {
      const label = (annotation.viewport_label || '').toLowerCase();
      if (!label) return 0;
      if (lowerCategory.includes('floor') && label.includes('floor')) return 3;
      if (lowerCategory.includes('ceiling') && label.includes('ceiling')) return 3;
      if (label.includes('plan')) return 2;
      if (label.includes('elevation')) return 1;
      return 0;
    };

    let best = annotations[0];
    let score = priority(best);
    for (const annotation of annotations.slice(1)) {
      const nextScore = priority(annotation);
      if (nextScore > score) {
        best = annotation;
        score = nextScore;
      }
    }
    return best;
  }

  private convertPixelsToFeet(
    lengthPx: number,
    sheet: SheetData,
    annotation?: ScaleAnnotation,
  ): number | undefined {
    const ratioLength = this.convertUsingScaleRatio(lengthPx, sheet, annotation?.scale_ratio);
    if (ratioLength !== undefined) {
      return ratioLength;
    }

    const scaleNote = annotation?.scale_note || sheet.scale || '';
    if (!scaleNote) return undefined;
    return this.convertUsingScaleNote(lengthPx, sheet, scaleNote);
  }

  private convertUsingScaleRatio(
    lengthPx: number,
    sheet: SheetData,
    ratio?: ScaleAnnotation['scale_ratio'] | null,
  ): number | undefined {
    if (!ratio || !ratio.plan_value || !ratio.real_value) {
      return undefined;
    }

    const planInches = this.planValueToInches(ratio.plan_value, ratio.plan_units);
    const realFeet = this.realValueToFeet(ratio.real_value, ratio.real_units);
    if (!planInches || !realFeet) {
      return undefined;
    }

    const dpi = sheet.renderDpi || this.defaultDpi;
    if (!dpi || dpi <= 0) {
      return undefined;
    }

    const inchesPerPixel = 1 / dpi;
    const planInchesMeasured = lengthPx * inchesPerPixel;
    const feetPerPlanInch = realFeet / planInches;
    if (!Number.isFinite(feetPerPlanInch)) {
      return undefined;
    }

    return planInchesMeasured * feetPerPlanInch;
  }

  private convertUsingScaleNote(lengthPx: number, sheet: SheetData, scaleNote: string): number | undefined {
    const scale = this.parseScaleNote(scaleNote);
    if (!scale) return undefined;

    const dpi = sheet.renderDpi || this.defaultDpi;
    if (!dpi || dpi <= 0) return undefined;

    const planInchesPerPixel = 1 / dpi;
    const planInches = lengthPx * planInchesPerPixel;
    const feetPerPlanInch = scale.realFeet / scale.planInches;
    if (!Number.isFinite(feetPerPlanInch)) {
      return undefined;
    }
    return planInches * feetPerPlanInch;
  }

  private planValueToInches(value: number, units?: string | null): number | undefined {
    if (!Number.isFinite(value) || value <= 0) {
      return undefined;
    }
    const normalized = (units || 'inch').toLowerCase();
    switch (normalized) {
      case 'inch':
      case 'in':
      case '"':
        return value;
      case 'foot':
      case 'ft':
      case "'":
        return value * 12;
      case 'mm':
      case 'millimeter':
      case 'millimetre':
        return value / 25.4;
      case 'cm':
      case 'centimeter':
      case 'centimetre':
        return value / 2.54;
      case 'm':
      case 'meter':
      case 'metre':
        return value * 39.3700787;
      default:
        return undefined;
    }
  }

  private realValueToFeet(value: number, units?: string | null): number | undefined {
    if (!Number.isFinite(value) || value <= 0) {
      return undefined;
    }
    const normalized = (units || 'foot').toLowerCase();
    switch (normalized) {
      case 'foot':
      case 'ft':
      case "'":
        return value;
      case 'inch':
      case 'in':
      case '"':
        return value / 12;
      case 'mm':
      case 'millimeter':
      case 'millimetre':
        return value / 304.8;
      case 'cm':
      case 'centimeter':
      case 'centimetre':
        return value / 30.48;
      case 'm':
      case 'meter':
      case 'metre':
        return value * 3.28084;
      default:
        return undefined;
    }
  }

  private parseScaleNote(scaleNote: string): { planInches: number; realFeet: number } | undefined {
    const ratioMatch = scaleNote.match(/(\d+)\s*\/\s*(\d+)"?\s*=\s*(\d+)'(?:-(\d+)")?/);
    if (ratioMatch) {
      const planNumerator = parseFloat(ratioMatch[1]);
      const planDenominator = parseFloat(ratioMatch[2]);
      const realFeet = parseFloat(ratioMatch[3]) + (ratioMatch[4] ? parseFloat(ratioMatch[4]) / 12 : 0);
      if (planNumerator > 0 && planDenominator > 0 && realFeet > 0) {
        return { planInches: planNumerator / planDenominator, realFeet };
      }
    }
    const metricMatch = scaleNote.match(/1\s*:\s*(\d+)/);
    if (metricMatch) {
      const ratio = parseFloat(metricMatch[1]);
      if (ratio > 0) {
        return { planInches: 1, realFeet: (ratio / 1000) * 3.28084 };
      }
    }
    return undefined;
  }
}

