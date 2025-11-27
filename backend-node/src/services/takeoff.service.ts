import { Types } from 'mongoose';
import { JobModel } from '../models/job.model';
import { SheetModel } from '../models/sheet.model';
import { FeatureModel, FeatureDocument } from '../models/feature.model';
import { HttpError } from '../utils/http-error';

export interface TakeoffResponse {
  version: string;
  units: {
    linear: string;
    area: string;
    volume?: string;
  };
  sheets: Array<{
    id: string;
    index: number;
    name?: string;
    scale?: string;
    units?: string;
    discipline?: string;
  }>;
  rooms: FeatureSummary[];
  walls: FeatureSummary[];
  openings: FeatureSummary[];
  pipes: FeatureSummary[];
  ducts: FeatureSummary[];
  fixtures: FeatureSummary[];
  meta: {
    fileId: string;
    jobId: string;
    generatedAt: string;
  };
}

export interface FeatureSummary {
  id: string;
  sheetId?: string;
  type: string;
  props?: Record<string, unknown>;
  area?: number;
  length?: number;
  count?: number;
}

export const buildTakeoffResponse = async (jobId: string): Promise<TakeoffResponse> => {
  const job = await JobModel.findById(jobId).populate('file');
  if (!job) {
    throw new HttpError(404, 'Job not found');
  }

  const sheets = await SheetModel.find({ job: job._id }).sort({ index: 1 });
  const features = await FeatureModel.find({ job: job._id });
  const units = deriveUnits(sheets);
  const grouped = groupByType(features);

  return {
    version: '2025-10-01',
    units,
    sheets: sheets.map((sheet) => ({
      id: sheet._id.toString(),
      index: sheet.index,
      name: sheet.name,
      discipline: sheet.discipline,
      scale: sheet.scale,
      units: sheet.units,
    })),
    rooms: (grouped.ROOM ?? []).map(formatRoom),
    walls: (grouped.WALL ?? []).map(formatWall),
    openings: (grouped.OPENING ?? []).map(formatOpening),
    pipes: (grouped.PIPE ?? []).map(formatPipe),
    ducts: (grouped.DUCT ?? []).map(formatDuct),
    fixtures: (grouped.FIXTURE ?? []).map(formatFixture),
    meta: {
      fileId: extractFileId(job.file),
      jobId: job._id.toString(),
      generatedAt: new Date().toISOString(),
    },
  };
};

const deriveUnits = (
  sheets: Array<{ units?: string }>,
): { linear: string; area: string; volume: string } => {
  const units = sheets.find((sheet) => sheet.units)?.units ?? 'ft';
  return {
    linear: units,
    area: units === 'm' ? 'm2' : 'ft2',
    volume: units === 'm' ? 'm3' : 'ft3',
  };
};

const groupByType = (features: FeatureDocument[]): Record<string, FeatureDocument[]> =>
  features.reduce<Record<string, FeatureDocument[]>>((acc, feature) => {
    if (!acc[feature.type]) {
      acc[feature.type] = [];
    }
    acc[feature.type].push(feature);
    return acc;
  }, {});

const extractFileId = (file: unknown): string => {
  if (!file) return '';
  if (file instanceof Types.ObjectId) return file.toString();
  if (typeof file === 'string') return file;
  if (typeof file === 'object' && '_id' in file && file._id) {
    return String((file as { _id: Types.ObjectId | string })._id);
  }
  return String(file);
};

const withBaseFields = (feature: FeatureDocument) => ({
  id: feature._id.toString(),
  sheetId: feature.sheet?.toString(),
  type: feature.type.toLowerCase(),
});

const formatRoom = (feature: FeatureDocument) => {
  const props = (feature.props ?? {}) as Record<string, any>;
  return {
    ...withBaseFields(feature),
    name: props.name,
    program: props.program,
    level: props.level,
    area: feature.area ?? props.areaSqFt,
    count: feature.count ?? 1,
    finishes: props.finishes,
    specifications: props.specifications,
  };
};

const formatWall = (feature: FeatureDocument) => {
  const props = (feature.props ?? {}) as Record<string, any>;
  return {
    ...withBaseFields(feature),
    partitionType: props.partitionType ?? props.type ?? '',
    length: feature.length ?? props.lengthFt,
    height: props.heightFt ?? props.height,
    level: props.level,
  };
};

const formatOpening = (feature: FeatureDocument) => {
  const props = (feature.props ?? {}) as Record<string, any>;
  return {
    ...withBaseFields(feature),
    openingType: props.openingType ?? props.type ?? '',
    width: props.widthFt ?? props.width,
    height: props.heightFt ?? props.height,
    count: feature.count ?? 1,
  };
};

const formatPipe = (feature: FeatureDocument) => {
  const props = (feature.props ?? {}) as Record<string, any>;
  return {
    ...withBaseFields(feature),
    service: props.service ?? props.system,
    diameterIn: props.diameterIn ?? props.diameter,
    length: feature.length ?? props.lengthFt,
    material: props.material,
    routing: props.routing,
    calculation: props.calculation,
  };
};

const formatDuct = (feature: FeatureDocument) => {
  const props = (feature.props ?? {}) as Record<string, any>;
  return {
    ...withBaseFields(feature),
    size: props.size,
    service: props.service,
    length: feature.length ?? props.lengthFt,
  };
};

const formatFixture = (feature: FeatureDocument) => {
  const props = (feature.props ?? {}) as Record<string, any>;
  return {
    ...withBaseFields(feature),
    fixtureType: props.fixtureType ?? props.type ?? '',
    service: props.service,
    count: feature.count ?? props.count ?? 1,
  };
};

