import { config } from '../config/env';
import { logger } from '../utils/logger';
import {
  PlanAnalysisPageResult,
  PlanAnalysisResult as VisionPlanResult,
  PlanAnalysisService,
} from './vision/plan-analysis.service';
import { OpenAIVisionService } from './vision/openai-vision.service';

export interface PageFeatureSet {
  pageIndex: number;
  sheetTitle: string;
  discipline?: string;
  scale?: string;
  units?: string;
  rooms: Array<{
    id?: string;
    name?: string;
    program?: string;
    level?: string;
    areaSqFt?: number;
  }>;
  walls: Array<{
    id?: string;
    partitionType?: string;
    level?: string;
    lengthFt?: number;
    heightFt?: number;
  }>;
  openings: Array<{
    id?: string;
    openingType: 'door' | 'window';
    widthFt?: number;
    heightFt?: number;
  }>;
  pipes: Array<{
    id?: string;
    service?: string;
    diameterIn?: number;
    lengthFt?: number;
  }>;
  ducts: Array<{
    id?: string;
    service?: string;
    size?: string;
    lengthFt?: number;
  }>;
  fixtures: Array<{
    id?: string;
    fixtureType?: string;
    service?: string;
    count?: number;
  }>;
  notes: string[];
}

export interface PlanAnalysisResult {
  pages: PageFeatureSet[];
}

export class OpenAIPlanService {
  private readonly planAnalyzer?: PlanAnalysisService;

  constructor() {
    if (config.openAiApiKey) {
      const visionService = new OpenAIVisionService({
        apiKey: config.openAiApiKey,
        allowMockFallback: config.vision.allowMock,
        nodeEnv: config.nodeEnv,
        maxRetries: config.openAiMaxRetries,
        retryDelayMs: config.openAiRetryDelayMs,
      });

      this.planAnalyzer = new PlanAnalysisService(visionService, {
        batchSize: config.vision.batchSize,
        pdfConversionTimeoutMs: config.vision.pdfConversionTimeoutMs,
        pdfRenderDpi: config.vision.pdfRenderDpi,
        pdfRenderMaxPages: config.vision.pdfRenderMaxPages,
      });
    } else {
      logger.warn('OpenAI API key not configured - plan analysis disabled');
    }
  }

  isEnabled(): boolean {
    return Boolean(this.planAnalyzer);
  }

  async analyze(
    pdfBuffer: Buffer,
    fileName: string,
    disciplines: string[],
    targets: string[],
  ): Promise<PlanAnalysisResult> {
    if (!this.planAnalyzer) {
      throw new Error('OpenAI API key not configured');
    }

    const analysis: VisionPlanResult = await this.planAnalyzer.analyzePlanFile(
      pdfBuffer,
      fileName,
      disciplines,
      targets,
    );

    const pages = analysis.pages.map((page) => this.mapPageToFeatureSet(page));
    return { pages };
  }

  private mapPageToFeatureSet(page: PlanAnalysisPageResult): PageFeatureSet {
    const units = page.scale?.units || 'ft';
    const features = page.features || {};
    const notes: string[] = [];
    if (page.metadata?.viewType) {
      notes.push(`View type: ${page.metadata.viewType}`);
    }
    if (page.metadata?.error) {
      notes.push(`Vision error: ${page.metadata.error}`);
    }
    if (page.metadata?.sheetTitle && page.metadata.sheetTitle !== page.fileName) {
      notes.push(`Detected title: ${page.metadata.sheetTitle}`);
    }

    return {
      pageIndex: page.pageIndex,
      sheetTitle: page.fileName || `Sheet ${page.pageIndex + 1}`,
      discipline: page.discipline,
      scale: page.scale?.detected,
      units,
      rooms: (features.rooms || []).map((room, idx) => ({
        id: room.id || `room_${idx + 1}`,
        name: room.name,
        program: room.program ?? undefined,
        level: room.level,
        areaSqFt: this.convertArea(room.area, units),
      })),
      walls: (features.walls || []).map((wall, idx) => ({
        id: wall.id || `wall_${idx + 1}`,
        partitionType: wall.partitionType,
        level: wall.level,
        lengthFt: this.convertLength(wall.length, units),
        heightFt: this.toNumber(wall.heightFt),
      })),
      openings: (features.openings || []).map((opening, idx) => ({
        id: opening.id || `opening_${idx + 1}`,
        openingType: opening.type === 'door' ? 'door' : 'window',
        widthFt: this.toNumber(opening.width),
        heightFt: this.toNumber(opening.height),
      })),
      pipes: (features.pipes || []).map((pipe, idx) => ({
        id: pipe.id || `pipe_${idx + 1}`,
        service: pipe.service,
        diameterIn: this.toNumber(pipe.diameter),
        lengthFt: this.convertLength(pipe.length, units),
      })),
      ducts: (features.ducts || []).map((duct, idx) => ({
        id: duct.id || `duct_${idx + 1}`,
        size: duct.size,
        lengthFt: this.convertLength(duct.length, units),
      })),
      fixtures: (features.fixtures || []).map((fixture, idx) => ({
        id: fixture.id || `fixture_${idx + 1}`,
        fixtureType: fixture.type,
        service: undefined,
        count: this.toNumber(fixture.count) ?? 1,
      })),
      notes,
    };
  }

  private toNumber(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string') {
      const parsed = parseFloat(value);
      return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
  }

  private convertLength(value: unknown, units: string): number | undefined {
    const numeric = this.toNumber(value);
    if (numeric === undefined) {
      return undefined;
    }
    if (units === 'm') {
      return numeric * 3.28084;
    }
    return numeric;
  }

  private convertArea(value: unknown, units: string): number | undefined {
    const numeric = this.toNumber(value);
    if (numeric === undefined) {
      return undefined;
    }
    if (units === 'm') {
      return numeric * 10.7639;
    }
    return numeric;
  }
}

