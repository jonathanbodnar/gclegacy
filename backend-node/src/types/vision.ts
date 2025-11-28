export interface RawPage {
  index: number;
  text: string;
  imagePath?: string;
  widthPx?: number;
  heightPx?: number;
}

export interface SheetClassificationMetadata {
  sheetId?: string | null;
  title?: string | null;
  discipline: string[];
  category:
    | 'site'
    | 'demo_floor'
    | 'floor'
    | 'fixture'
    | 'rcp'
    | 'elevations'
    | 'sections'
    | 'materials'
    | 'furniture'
    | 'artwork'
    | 'rr_details'
    | 'other';
  confidence?: number | null;
  notes?: string | null;
  isPrimaryPlan?: boolean | null;
}

export interface SheetContent {
  rasterData?: Buffer;
  vectorData?: unknown;
  textData?: string;
  layerData?: unknown;
  modelData?: unknown;
  metadata?: Record<string, unknown>;
}

export interface SheetData extends RawPage {
  name?: string;
  discipline?: string;
  scale?: string;
  units?: string;
  sheetIdGuess?: string;
  pageSize?: {
    widthPt: number;
    heightPt: number;
  };
  renderDpi?: number;
  content: SheetContent;
  classification?: SheetClassificationMetadata;
}

export interface IngestMetadata {
  totalPages: number;
  detectedDisciplines: string[];
  fileType: string;
}

export interface IngestResult {
  fileId: string;
  sheets: SheetData[];
  rawPages?: RawPage[];
  metadata: IngestMetadata;
}

export interface RoomScheduleEntry {
  sheetIndex: number;
  sheetName?: string;
  room_number: string;
  room_name: string;
  floor_finish_code?: string | null;
  wall_finish_code?: string | null;
  ceiling_finish_code?: string | null;
  base_code?: string | null;
  sourceCategory?: string;
  notes?: string | null;
}

export interface RoomSpatialMapping {
  sheetIndex: number;
  sheetName?: string;
  room_number: string;
  room_name: string;
  label_center_px?: [number, number] | null;
  bounding_box_px?: [number, number, number, number] | null;
  confidence?: number | null;
  notes?: string | null;
}

export interface ScaleRatio {
  plan_units?: string | null;
  plan_value?: number | null;
  real_units?: string | null;
  real_value?: number | null;
}

export interface ScaleAnnotation {
  sheetIndex: number;
  sheetName?: string;
  sheet_id?: string | null;
  viewport_label?: string | null;
  scale_note?: string | null;
  scale_ratio?: ScaleRatio | null;
  confidence?: number | null;
  notes?: string | null;
}

export type SpaceCategory = 'cafe' | 'sales' | 'boh' | 'restroom' | 'patio' | 'other';

export interface SpaceDefinition {
  sheetIndex: number;
  sheetName?: string;
  sheetRef?: string | null;
  space_id: string;
  name?: string | null;
  raw_label_text?: string | null;
  raw_area_string?: string | null;
  category: SpaceCategory;
  bbox_px: [number, number, number, number];
  approx_area_sqft?: number | null;
  confidence?: number | null;
  notes?: string | null;
}

export interface PartitionTypeDefinition {
  sheetIndex: number;
  sheetName?: string;
  partition_type_id: string;
  fire_rating?: string | null;
  layer_description?: string[];
  stud_size?: string | null;
  stud_gauge?: string | null;
  has_acoustical_insulation?: boolean | null;
  notes?: string | null;
}

export interface WallRunSegment {
  sheetIndex: number;
  sheetName?: string;
  id: string;
  partition_type_id?: string | null;
  new_or_existing?: 'new' | 'existing' | 'demo' | null;
  endpoints_px: [number, number][];
  adjacent_rooms?: (string | null)[];
  space_ids?: (string | null)[];
  notes?: string | null;
  confidence?: number | null;
}

export interface RoomCeilingHeight {
  sheetIndex: number;
  sheetName?: string;
  room_number: string;
  space_id?: string | null;
  height_ft?: number | null;
  source_note?: string | null;
  source_sheet?: string | null;
  confidence?: number | null;
  notes?: string | null;
}

