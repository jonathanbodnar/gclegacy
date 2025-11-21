import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

import { IngestResult } from '../ingest/ingest.service';
import { appendVisionLog } from '../vision/vision.logger';

export interface ScopeDiagnosisInput {
  jobId: string;
  fileId: string;
  disciplines: string[];
  targets: string[];
  ingestResult?: IngestResult;
  analysisSummary?: any;
  features: any[];
}

export interface ScopeDiagnosisResult {
  summary: string;
  featureCounts: Record<string, number>;
  csiDivisions: CSIDivisionDiagnosis[];
  assemblies: AssemblyDiagnosis[];
  materials: MaterialRequirement[];
  verticalSystems?: VerticalDiagnosis;
  fittings?: FittingEstimate[];
  confidence: number;
  notes?: string[];
}

export interface CSIDivisionDiagnosis {
  division: string;
  title: string;
  confidence: number;
  drivers?: string[];
  assemblies?: string[];
}

export interface AssemblyDiagnosis {
  name: string;
  description?: string;
  quantity?: number;
  unit?: string;
  drivers?: string[];
  confidence: number;
  csiDivision?: string;
}

export interface MaterialRequirement {
  name: string;
  quantity?: number;
  unit?: string;
  confidence: number;
  notes?: string;
  sourceFeatureTypes?: string[];
}

export interface VerticalDiagnosis {
  defaultStoryHeightFt?: number;
  levels?: Array<{ name: string; elevationFt?: number; heightFt?: number }>;
  riserCount?: number;
  totalRiserHeightFt?: number;
  notes?: string[];
}

export interface FittingEstimate {
  system: string;
  elbows?: number;
  tees?: number;
  couplings?: number;
  reducers?: number;
  confidence: number;
  notes?: string[];
}

const FEATURE_CSI_MAP: Record<
  string,
  { division: string; title: string; assembly: string }
> = {
  ROOM: { division: '09 00 00', title: 'Finishes', assembly: 'Interior Spaces' },
  WALL: {
    division: '09 20 00',
    title: 'Partitions & Ceilings',
    assembly: 'Gypsum Partitions',
  },
  OPENING: {
    division: '08 10 00',
    title: 'Doors and Frames',
    assembly: 'Door / Window Systems',
  },
  PIPE: {
    division: '22 00 00',
    title: 'Plumbing',
    assembly: 'Domestic / Waste Piping',
  },
  FIXTURE: {
    division: '22 40 00',
    title: 'Plumbing Fixtures',
    assembly: 'Fixture Package',
  },
  DUCT: {
    division: '23 30 00',
    title: 'HVAC Air Distribution',
    assembly: 'Ductwork',
  },
  LEVEL: {
    division: '01 10 00',
    title: 'Summary of Work',
    assembly: 'Vertical Datum',
  },
  ELEVATION: {
    division: '06 00 00',
    title: 'Wood, Plastics & Composites',
    assembly: 'Wall Elevations',
  },
  SECTION: {
    division: '03 00 00',
    title: 'Concrete / Structural Framing',
    assembly: 'Building Sections',
  },
  RISER: {
    division: '21 00 00',
    title: 'Fire Suppression / Vertical Systems',
    assembly: 'Riser Systems',
  },
};

@Injectable()
export class ScopeDiagnosisService {
  private readonly logger = new Logger(ScopeDiagnosisService.name);
  private readonly openai?: OpenAI;
  private readonly scopeModel: string;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    this.scopeModel =
      this.configService.get<string>('OPENAI_SCOPE_MODEL') ||
      this.configService.get<string>('OPENAI_TAKEOFF_MODEL') ||
      'gpt-4o-mini';

    if (apiKey) {
      this.openai = new OpenAI({ apiKey });
    } else {
      this.logger.warn(
        'OPENAI_API_KEY not configured - scope diagnosis will rely on heuristics',
      );
    }
  }

  async diagnoseScope(
    input: ScopeDiagnosisInput,
  ): Promise<ScopeDiagnosisResult> {
    const heuristicResult = this.buildHeuristicDiagnosis(input);

    if (!this.openai) {
      return heuristicResult;
    }

    try {
      const messages = [
        {
          role: 'system' as const,
          content:
            'You are a preconstruction estimator diagnosing CSI scope, assemblies, and vertical requirements. Respond with valid JSON.',
        },
        {
          role: 'user' as const,
          content: this.buildPrompt(input, heuristicResult),
        },
      ];

      const response = await this.openai.chat.completions.create({
        model: this.scopeModel,
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        this.logger.warn(
          'Scope diagnosis model returned empty response - using heuristics',
        );
        return heuristicResult;
      }

      const parsed = JSON.parse(content);
      const merged = this.mergeResults(heuristicResult, parsed);

      await appendVisionLog('Scope diagnosis complete', {
        jobId: input.jobId,
        confidence: merged.confidence,
      });

      return merged;
    } catch (error: any) {
      this.logger.warn(
        `Scope diagnosis model failed (${error.message}). Using heuristics.`,
      );
      await appendVisionLog('Scope diagnosis model failed', {
        jobId: input.jobId,
        error: error.message,
      });
      return heuristicResult;
    }
  }

  private buildHeuristicDiagnosis(
    input: ScopeDiagnosisInput,
  ): ScopeDiagnosisResult {
    const featureCounts = this.countFeatures(input.features);
    const wallLength = this.sumLinearMeasurement(input.features, 'WALL');
    const pipeLength = this.sumLinearMeasurement(input.features, 'PIPE');
    const ductLength = this.sumLinearMeasurement(input.features, 'DUCT');
    const fixtureCount = featureCounts.FIXTURE || 0;
    const csiDivisions = this.deriveCsiDivisions(input.features);
    const assemblies = this.deriveAssemblySummary(input.features, {
      wallLength,
      pipeLength,
      ductLength,
      fixtureCount,
    });
    const materials = this.deriveMaterialSummary(input.features, {
      wallLength,
      pipeLength,
      ductLength,
      fixtureCount,
    });
    const verticalSystems = this.buildVerticalSummary(
      input,
      input.features,
      pipeLength,
    );
    const fittings = this.buildFittingEstimates(input.features);
    const sheetCount = input.ingestResult?.metadata?.totalPages;
    const noteSegments = [];
    if (sheetCount) {
      noteSegments.push(
        `Analyzed ${sheetCount} sheets (${(input.ingestResult?.metadata?.detectedDisciplines || []).join(', ') || 'disciplines unknown'})`,
      );
    }
    if (!pipeLength && input.targets.includes('pipes')) {
      noteSegments.push('No piping runs detected - verify plumbing scope manually.');
    }
    if (!verticalSystems?.riserCount) {
      noteSegments.push('Vertical risers not detected; confirm elevations and riser diagrams.');
    }

    const summaryParts = [];
    if (featureCounts.ROOM) summaryParts.push(`${featureCounts.ROOM} rooms`);
    if (wallLength) summaryParts.push(`${wallLength.toFixed(0)} LF walls`);
    if (pipeLength) summaryParts.push(`${pipeLength.toFixed(0)} LF piping`);
    if (ductLength) summaryParts.push(`${ductLength.toFixed(0)} LF ductwork`);
    if (fixtureCount) summaryParts.push(`${fixtureCount} fixtures`);

    return {
      summary:
        summaryParts.length > 0
          ? `Detected ${summaryParts.join(', ')} across uploaded plans.`
          : 'Scope features detected but quantities are minimal - review manually.',
      featureCounts,
      csiDivisions,
      assemblies,
      materials,
      verticalSystems,
      fittings,
      confidence: 0.55,
      notes: noteSegments,
    };
  }

  private buildPrompt(
    input: ScopeDiagnosisInput,
    heuristics: ScopeDiagnosisResult,
  ): string {
    const sheetPreview = (input.ingestResult?.sheets || [])
      .slice(0, 5)
      .map((sheet) => ({
        index: sheet.index,
        name: sheet.name,
        discipline: sheet.discipline,
        scale: sheet.scale,
      }));

    const context = {
      jobId: input.jobId,
      fileId: input.fileId,
      disciplines: input.disciplines,
      targets: input.targets,
      sheets: sheetPreview,
      analysisSummary: input.analysisSummary,
    };

    return `PROJECT CONTEXT:
${JSON.stringify(context, null, 2)}

CURRENT HEURISTICS:
${JSON.stringify(
  {
    summary: heuristics.summary,
    featureCounts: heuristics.featureCounts,
    csiDivisions: heuristics.csiDivisions,
    assemblies: heuristics.assemblies,
    materials: heuristics.materials,
    verticalSystems: heuristics.verticalSystems,
    fittings: heuristics.fittings,
  },
  null,
  2,
)}

Refine these heuristics. Return JSON with keys:
- summary (string)
- featureCounts (record of feature type -> count)
- csiDivisions (array)
- assemblies (array)
- materials (array)
- verticalSystems (object)
- fittings (array)
- confidence (0-1)
- notes (array of strings)

Use CSI MasterFormat terminology where possible.`;
  }

  private mergeResults(
    heuristic: ScopeDiagnosisResult,
    aiResult: any,
  ): ScopeDiagnosisResult {
    const merged: ScopeDiagnosisResult = {
      ...heuristic,
      ...aiResult,
      featureCounts: heuristic.featureCounts,
    };

    if (!Array.isArray(merged.csiDivisions) || merged.csiDivisions.length === 0) {
      merged.csiDivisions = heuristic.csiDivisions;
    }
    if (!Array.isArray(merged.assemblies) || merged.assemblies.length === 0) {
      merged.assemblies = heuristic.assemblies;
    }
    if (!Array.isArray(merged.materials) || merged.materials.length === 0) {
      merged.materials = heuristic.materials;
    }
    if (!merged.verticalSystems) {
      merged.verticalSystems = heuristic.verticalSystems;
    }
    if (!Array.isArray(merged.notes)) {
      merged.notes = heuristic.notes;
    } else if (heuristic.notes?.length) {
      merged.notes = Array.from(new Set([...(heuristic.notes || []), ...merged.notes]));
    }

    if (typeof merged.confidence !== 'number') {
      merged.confidence = heuristic.confidence;
    }

    return merged;
  }

  private countFeatures(features: any[]): Record<string, number> {
    return features.reduce((acc, feature) => {
      const type = feature.type || 'UNKNOWN';
      acc[type] = (acc[type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
  }

  private sumLinearMeasurement(features: any[], type: string): number {
    return features
      .filter((feature) => feature.type === type)
      .reduce((sum, feature) => sum + (feature.length || feature.area || 0), 0);
  }

  private deriveCsiDivisions(features: any[]): CSIDivisionDiagnosis[] {
    const divisionMap = new Map<
      string,
      CSIDivisionDiagnosis & { count: number; assembliesSet: Set<string>; driversSet: Set<string> }
    >();

    for (const feature of features) {
      const mapping = FEATURE_CSI_MAP[feature.type];
      if (!mapping) continue;

      const key = mapping.division;
      if (!divisionMap.has(key)) {
        divisionMap.set(key, {
          division: mapping.division,
          title: mapping.title,
          confidence: 0.4,
          assemblies: [],
          drivers: [],
          count: 0,
          assembliesSet: new Set<string>(),
          driversSet: new Set<string>(),
        });
      }

      const bucket = divisionMap.get(key)!;
      bucket.count += 1;
      bucket.assembliesSet.add(mapping.assembly);

      if (feature.props?.partitionType) {
        bucket.driversSet.add(feature.props.partitionType);
      }
      if (feature.props?.service) {
        bucket.driversSet.add(feature.props.service);
      }
    }

    return Array.from(divisionMap.values()).map((entry) => ({
      division: entry.division,
      title: entry.title,
      confidence: Math.min(0.9, 0.4 + entry.count * 0.05),
      assemblies: Array.from(entry.assembliesSet),
      drivers: Array.from(entry.driversSet),
    }));
  }

  private deriveAssemblySummary(
    features: any[],
    totals: { wallLength: number; pipeLength: number; ductLength: number; fixtureCount: number },
  ): AssemblyDiagnosis[] {
    const assemblies: AssemblyDiagnosis[] = [];

    if (totals.wallLength > 0) {
      assemblies.push({
        name: 'Interior Partitions',
        description: 'Stud and gypsum assemblies derived from WALL features',
        quantity: Number(totals.wallLength.toFixed(1)),
        unit: 'lf',
        drivers: ['WALL'],
        confidence: 0.7,
        csiDivision: '09 20 00',
      });
    }

    if (totals.pipeLength > 0) {
      assemblies.push({
        name: 'Plumbing Distribution',
        description: 'Water / waste piping per PIPE targets',
        quantity: Number(totals.pipeLength.toFixed(1)),
        unit: 'lf',
        drivers: ['PIPE'],
        confidence: 0.65,
        csiDivision: '22 00 00',
      });
    }

    if (totals.ductLength > 0) {
      assemblies.push({
        name: 'HVAC Duct Runs',
        description: 'Supply / return ductwork',
        quantity: Number(totals.ductLength.toFixed(1)),
        unit: 'lf',
        drivers: ['DUCT'],
        confidence: 0.6,
        csiDivision: '23 30 00',
      });
    }

    if (totals.fixtureCount > 0) {
      assemblies.push({
        name: 'Fixture Package',
        description: 'Plumbing or electrical fixtures counted from plans',
        quantity: totals.fixtureCount,
        unit: 'ea',
        drivers: ['FIXTURE'],
        confidence: 0.62,
        csiDivision: '22 40 00',
      });
    }

    const roomCount = features.filter((feature) => feature.type === 'ROOM').length;
    if (roomCount > 0) {
      const totalArea =
        features
          .filter((feature) => feature.type === 'ROOM')
          .reduce((sum, room) => sum + (room.area || 0), 0) || undefined;

      assemblies.push({
        name: 'Interior Fit-Out',
        description: 'Rooms / program areas requiring finishes and specialties',
        quantity: totalArea ? Number(totalArea.toFixed(0)) : roomCount,
        unit: totalArea ? 'sf' : 'ea',
        drivers: ['ROOM'],
        confidence: 0.58,
        csiDivision: '09 00 00',
      });
    }

    return assemblies;
  }

  private deriveMaterialSummary(
    features: any[],
    totals: { wallLength: number; pipeLength: number; ductLength: number; fixtureCount: number },
  ): MaterialRequirement[] {
    const materials: MaterialRequirement[] = [];

    if (totals.wallLength > 0) {
      materials.push({
        name: 'Stud Framing',
        quantity: Number((totals.wallLength * 0.75).toFixed(1)),
        unit: 'ea',
        confidence: 0.6,
        notes: 'Assumes studs at 16" o.c.',
        sourceFeatureTypes: ['WALL'],
      });
      materials.push({
        name: 'Gypsum Board',
        quantity: Number((totals.wallLength * 2).toFixed(1)),
        unit: 'sf',
        confidence: 0.58,
        notes: 'Two sides standard partition coverage',
        sourceFeatureTypes: ['WALL'],
      });
    }

    if (totals.pipeLength > 0) {
      materials.push({
        name: 'Piping (various services)',
        quantity: Number(totals.pipeLength.toFixed(1)),
        unit: 'lf',
        confidence: 0.55,
        notes: 'Combine CW/HW/SAN services per takeoff',
        sourceFeatureTypes: ['PIPE'],
      });
    }

    if (totals.ductLength > 0) {
      materials.push({
        name: 'Galvanized Duct',
        quantity: Number(totals.ductLength.toFixed(1)),
        unit: 'lf',
        confidence: 0.5,
        notes: 'Includes supply and return runs',
        sourceFeatureTypes: ['DUCT'],
      });
    }

    if (totals.fixtureCount > 0) {
      materials.push({
        name: 'Fixtures',
        quantity: totals.fixtureCount,
        unit: 'ea',
        confidence: 0.6,
        notes: 'Plumbing/electrical devices counted from fixtures layer',
        sourceFeatureTypes: ['FIXTURE'],
      });
    }

    return materials;
  }

  private buildVerticalSummary(
    input: ScopeDiagnosisInput,
    features: any[],
    pipeLength: number,
  ): VerticalDiagnosis | undefined {
    const summary = input.analysisSummary;
    const levelsFromFeatures = features
      .filter((feature) => feature.type === 'LEVEL')
      .map((feature) => ({
        name: feature.props?.name,
        elevationFt: feature.props?.elevationFt,
        heightFt: feature.props?.heightFt,
      }));

    const vertical: VerticalDiagnosis = {
      defaultStoryHeightFt: summary?.defaultStoryHeightFt,
      levels: summary?.levels?.length ? summary.levels : levelsFromFeatures,
      riserCount: summary?.totalRisers || 0,
      totalRiserHeightFt: summary?.totalRiserHeight,
      notes: [],
    };

    if (!vertical.defaultStoryHeightFt && features.length > 0) {
      vertical.defaultStoryHeightFt = this.estimateStoryHeight(features);
      vertical.notes?.push('Story height estimated from room data.');
    }

    if (pipeLength > 0 && !vertical.riserCount) {
      vertical.notes?.push('Piping present without riser diagrams; consider riser assumptions.');
    }

    if (
      !vertical.defaultStoryHeightFt &&
      !vertical.riserCount &&
      (!vertical.levels || vertical.levels.length === 0)
    ) {
      return undefined;
    }

    return vertical;
  }

  private estimateStoryHeight(features: any[]): number | undefined {
    const heights: number[] = [];
    for (const feature of features) {
      if (typeof feature.props?.heightFt === 'number') {
        heights.push(feature.props.heightFt);
      }
    }
    if (!heights.length) {
      return undefined;
    }
    const avg = heights.reduce((sum, val) => sum + val, 0) / heights.length;
    return Number(avg.toFixed(1));
  }

  private buildFittingEstimates(features: any[]): FittingEstimate[] {
    const fittings: FittingEstimate[] = [];
    const pipeGroups = new Map<
      string,
      { length: number; count: number; label: string }
    >();

    for (const feature of features) {
      if (feature.type !== 'PIPE') continue;
      const service = feature.props?.service || 'PIPE';
      if (!pipeGroups.has(service)) {
        pipeGroups.set(service, { length: 0, count: 0, label: `${service} piping` });
      }
      const group = pipeGroups.get(service)!;
      group.length += feature.length || 0;
      group.count += 1;
    }

    pipeGroups.forEach((group, service) => {
      if (!group.length) return;
      fittings.push({
        system: group.label,
        elbows: Math.max(1, Math.round(group.count * 0.8)),
        tees: Math.max(0, Math.round(group.length / 40)),
        couplings: Math.max(1, Math.round(group.length / 20)),
        reducers: Math.round(group.length / 75),
        confidence: 0.4,
        notes: [
          `Estimated from ${group.length.toFixed(1)} LF across ${group.count} runs.`,
        ],
      });
    });

    const ductLength = this.sumLinearMeasurement(features, 'DUCT');
    if (ductLength > 0) {
      fittings.push({
        system: 'HVAC ductwork',
        elbows: Math.max(1, Math.round(ductLength / 60)),
        tees: Math.round(ductLength / 90),
        couplings: Math.round(ductLength / 30),
        reducers: Math.round(ductLength / 120),
        confidence: 0.35,
        notes: [`Based on ${ductLength.toFixed(1)} LF total duct run.`],
      });
    }

    return fittings;
  }
}
