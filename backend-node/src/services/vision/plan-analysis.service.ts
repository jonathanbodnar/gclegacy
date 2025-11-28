import { createRequire } from 'module';

import { renderPdfToImages } from '../../common/pdf/pdf-renderer';
import { logger as appLogger } from '../../utils/logger';
import { OpenAIVisionService, VisionAnalysisResult } from './openai-vision.service';

type ScopedLogger = {
  log: (message: string, payload?: unknown) => void;
  warn: (message: string, payload?: unknown) => void;
  error: (message: string, payload?: unknown) => void;
  debug: (message: string, payload?: unknown) => void;
};

const createScopedLogger = (scope: string): ScopedLogger => ({
  log: (message, payload) => appLogger.info(`[${scope}] ${message}`, payload),
  warn: (message, payload) => appLogger.warn(`[${scope}] ${message}`, payload),
  error: (message, payload) => appLogger.error(`[${scope}] ${message}`, payload),
  debug: (message, payload) => {
    if ((process.env.NODE_ENV || 'development') !== 'production') {
      appLogger.info(`[${scope}] ${message}`, payload);
    }
  },
});

export interface PlanAnalysisOptions {
  batchSize?: number;
  pdfConversionTimeoutMs?: number;
  pdfRenderDpi?: number;
  pdfRenderMaxPages?: number;
}

export interface PlanAnalysisPageResult {
  pageIndex: number;
  fileName: string;
  discipline: string;
  scale: VisionAnalysisResult['scale'] | null;
  features: VisionAnalysisResult;
  metadata: Record<string, unknown>;
}

export interface PlanAnalysisSummary {
  rooms: number;
  walls: number;
  openings: number;
  pipes: number;
  ducts: number;
  fixtures: number;
}

export interface PlanAnalysisResult {
  fileName: string;
  totalPages: number;
  pages: PlanAnalysisPageResult[];
  summary: PlanAnalysisSummary;
}

export class PlanAnalysisService {
  private readonly logger = createScopedLogger('PlanAnalysisService');
  private readonly options: Required<PlanAnalysisOptions>;

  constructor(
    private readonly openaiVision: OpenAIVisionService,
    options: PlanAnalysisOptions = {},
  ) {
    const env = process.env;
    this.options = {
      batchSize: options.batchSize ?? parseInt(env.VISION_BATCH_SIZE || '10', 10),
      pdfConversionTimeoutMs:
        options.pdfConversionTimeoutMs ??
        (env.PDF_CONVERSION_TIMEOUT_MS
          ? parseInt(env.PDF_CONVERSION_TIMEOUT_MS, 10)
          : env.PDF_CONVERSION_TIMEOUT_MIN
          ? parseInt(env.PDF_CONVERSION_TIMEOUT_MIN, 10) * 60 * 1000
          : 60 * 60 * 1000),
      pdfRenderDpi: options.pdfRenderDpi ?? parseInt(env.PDF_RENDER_DPI || '220', 10),
      pdfRenderMaxPages:
        options.pdfRenderMaxPages ??
        (env.PDF_RENDER_MAX_PAGES
          ? parseInt(env.PDF_RENDER_MAX_PAGES, 10)
          : env.OPENAI_MAX_PAGES
          ? parseInt(env.OPENAI_MAX_PAGES, 10)
          : 100),
    };
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    errorMessage: string,
  ): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) => setTimeout(() => reject(new Error(errorMessage)), timeoutMs)),
    ]);
  }

  async analyzePlanFile(
    fileBuffer: Buffer,
    fileName: string,
    disciplines: string[],
    targets: string[],
    options?: Record<string, unknown>,
    progressCallback?: (current: number, total: number, message: string) => Promise<void>,
  ): Promise<PlanAnalysisResult> {
    if ((process.env.NODE_ENV || 'development') !== 'production') {
      this.logger.log(`Starting plan analysis for ${fileName}`);
    }

    const timeoutMs = this.options.pdfConversionTimeoutMs;
    const timeoutMinutes = Math.round(timeoutMs / 60000);

    try {
      this.logger.log(`Converting PDF to images for analysis: ${fileName}`);
      const images = await this.withTimeout(
        this.convertToImages(fileBuffer, fileName),
        timeoutMs,
        `PDF to images conversion timeout after ${timeoutMinutes} minutes for ${fileName}.`,
      );
      this.logger.log(`Successfully converted ${images.length} pages to images`);

      const results: PlanAnalysisPageResult[] = [];
      let completedCount = 0;
      this.logger.log(`Starting parallel analysis of ${images.length} pages`);

      for (let i = 0; i < images.length; i += this.options.batchSize) {
        const batch = images.slice(i, i + this.options.batchSize);
        const batchNumber = Math.floor(i / this.options.batchSize) + 1;
        const totalBatches = Math.ceil(images.length / this.options.batchSize);

        this.logger.log(
          `Processing batch ${batchNumber}/${totalBatches} (pages ${i + 1}-${Math.min(
            i + batch.length,
            images.length,
          )})`,
        );

        const batchPromises = batch.map(async (imageBuffer, batchIndex) => {
          const pageIndex = i + batchIndex;
          try {
            const pageResult = await this.openaiVision.analyzePlanImage(
              imageBuffer,
              disciplines,
              targets,
              options,
            );

            const scaleInfo =
              pageResult.scale ||
              ({
                detected: 'Unknown',
                units: 'ft',
                ratio: 1,
                confidence: 'low',
                method: 'assumed',
              } as const);

            const sheetTitle = pageResult.sheetTitle || `${fileName}_page_${pageIndex + 1}`;
            completedCount += 1;

            return {
              pageIndex,
              fileName: sheetTitle,
              discipline: this.detectDisciplineFromContent(pageResult, disciplines),
              scale: scaleInfo,
              features: pageResult,
              metadata: {
                imageSize: imageBuffer.length,
                analysisTimestamp: new Date().toISOString(),
                viewType: this.detectViewType(pageResult),
                sheetTitle: pageResult.sheetTitle,
              },
            };
          } catch (error: any) {
            completedCount += 1;
            this.logger.error(`Failed to analyze page ${pageIndex + 1}`, error.message);
            return {
              pageIndex,
              fileName: `${fileName}_page_${pageIndex + 1}`,
              discipline: 'UNKNOWN',
              scale: null,
              features: {
                rooms: [],
                walls: [],
                openings: [],
                pipes: [],
                ducts: [],
                fixtures: [],
              } as VisionAnalysisResult,
              metadata: {
                error: error.message,
                analysisTimestamp: new Date().toISOString(),
              },
            };
          }
        });

        const batchResults = await Promise.all(batchPromises);
        results.push(...(batchResults as PlanAnalysisPageResult[]));

        batch.forEach((_, idx) => {
          batch[idx] = Buffer.alloc(0);
        });

        if (global.gc) {
          const beforeMem = process.memoryUsage();
          const beforeRssMB = Math.round(beforeMem.rss / 1024 / 1024);
          try {
            global.gc();
            const afterMem = process.memoryUsage();
            const afterRssMB = Math.round(afterMem.rss / 1024 / 1024);
            const freedMB = beforeRssMB - afterRssMB;
            if (freedMB > 50 || beforeRssMB > 2000) {
              this.logger.log(
                `🧹 GC after batch ${batchNumber}/${totalBatches}: RSS ${beforeRssMB}MB -> ${afterRssMB}MB (freed ${freedMB}MB)`,
              );
            }
          } catch {
            //
          }
        }

        if ((process.env.NODE_ENV || 'development') !== 'production') {
          this.logger.log(
            `Completed batch ${batchNumber}/${totalBatches} - Total analyzed: ${results.length}/${images.length}`,
          );
        }

        if (progressCallback) {
          await progressCallback(
            completedCount,
            images.length,
            `Analyzing plans: ${completedCount}/${images.length} pages completed`,
          );
        }
      }

      results.sort((a, b) => a.pageIndex - b.pageIndex);

      return {
        fileName,
        totalPages: images.length,
        pages: results,
        summary: this.generateSummary(results),
      };
    } catch (error: any) {
      this.logger.error(`Plan analysis failed for ${fileName}`, error.message);
      throw error;
    }
  }

  private async convertToImages(fileBuffer: Buffer, fileName: string): Promise<Buffer[]> {
    const extension = fileName.split('.').pop()?.toLowerCase();
    switch (extension) {
      case 'pdf':
        return this.convertPdfToImages(fileBuffer);
      case 'dwg':
      case 'dxf':
        return this.convertCadToImages(fileBuffer);
      case 'png':
      case 'jpg':
      case 'jpeg':
        return [fileBuffer];
      default:
        throw new Error(
          `Unsupported file extension "${extension}" - only PDF, DWG/DXF, and raster images are supported.`,
        );
    }
  }

  private async convertPdfToImages(pdfBuffer: Buffer): Promise<Buffer[]> {
    let totalPages = 0;
    try {
      totalPages = await this.getPdfPageCount(pdfBuffer);
      if ((process.env.NODE_ENV || 'development') !== 'production') {
        this.logger.log(`PDF has ${totalPages} total pages - will process all pages`);
      }
    } catch (error: any) {
      this.logger.warn(`Failed to get PDF page count: ${error.message}. Proceeding without count.`);
    }

    const pagesToProcess = totalPages > 0 ? totalPages : this.options.pdfRenderMaxPages;

    try {
      const rendered = await renderPdfToImages(pdfBuffer, {
        dpi: this.options.pdfRenderDpi,
        maxPages: pagesToProcess,
      });

      if (rendered.length > 0) {
        if ((process.env.NODE_ENV || 'development') !== 'production') {
          this.logger.log(`Successfully rendered ${rendered.length} pages from PDF`);
        }
        return rendered.map((page) => page.buffer);
      }

      this.logger.warn(
        'PDF rendering completed but no pages were generated. This may be due to XFA parsing errors or other issues.',
      );
      return [];
    } catch (renderError: any) {
      if (
        renderError?.message &&
        (renderError.message.includes('XFA') || renderError.message.includes('rich text'))
      ) {
        this.logger.warn(
          `PDF rendering encountered XFA parsing errors: ${renderError.message}.`,
        );
        return [];
      }
      this.logger.error(`Canvas-based PDF rendering failed`, renderError.message);
      throw new Error(
        "PDF conversion failed: Unable to render pages with pdfjs/canvas. Ensure the '@napi-rs/canvas' dependency is installed.",
      );
    }
  }

  private async getPdfPageCount(pdfBuffer: Buffer): Promise<number> {
    const nodeRequire = createRequire(__filename);
    const errors: string[] = [];
    let pdfjsLib: any;

    try {
      pdfjsLib = nodeRequire('pdfjs-dist/legacy/build/pdf.js');
      if (!pdfjsLib || typeof pdfjsLib.getDocument !== 'function') {
        throw new Error('Module loaded but getDocument is not a function');
      }
    } catch (legacyError: any) {
      errors.push(`legacy build require failed: ${legacyError.message}`);
      try {
        pdfjsLib = nodeRequire('pdfjs-dist/build/pdf.js');
        if (!pdfjsLib || typeof pdfjsLib.getDocument !== 'function') {
          throw new Error('Module loaded but getDocument is not a function');
        }
      } catch (requireError: any) {
        errors.push(`build/pdf.js require failed: ${requireError.message}`);
        try {
          const pdfjsModule = await import('pdfjs-dist');
          pdfjsLib = pdfjsModule.default || pdfjsModule;
          if (!pdfjsLib || typeof pdfjsLib.getDocument !== 'function') {
            throw new Error('Module loaded but getDocument is not a function');
          }
        } catch (importError: any) {
          errors.push(`ES module import failed: ${importError.message}`);
          throw new Error(
            `Could not load pdfjs-dist. Attempted paths:\n${errors.join(
              '\n',
            )}\n\nPlease ensure pdfjs-dist is installed.`,
          );
        }
      }
    }

    if (!pdfjsLib) {
      throw new Error('pdfjs-dist library could not be loaded');
    }

    try {
      const loadingTask = pdfjsLib.getDocument({
        data: new Uint8Array(pdfBuffer),
      });
      const pdfDoc = await loadingTask.promise;
      return pdfDoc.numPages;
    } catch (error: any) {
      this.logger.warn(`Failed to get PDF page count: ${error?.message || String(error)}`);
      throw error;
    }
  }

  private async convertCadToImages(_cadBuffer: Buffer): Promise<Buffer[]> {
    throw new Error('DWG/DXF conversion is not implemented for plan analysis yet.');
  }

  private detectDisciplineFromContent(
    content: VisionAnalysisResult,
    requestedDisciplines: string[],
  ): string {
    const scores = {
      A: 0,
      P: 0,
      M: 0,
      E: 0,
    };

    const increment = (key: keyof typeof scores, amount = 1) => {
      scores[key] += amount;
    };

    (content.rooms || []).forEach(() => increment('A'));
    (content.walls || []).forEach(() => increment('A'));
    (content.openings || []).forEach(() => increment('A'));

    (content.pipes || []).forEach(() => increment('P'));
    (content.fixtures || []).forEach((fixture) => {
      const type = fixture.type?.toLowerCase() || '';
      if (type.includes('sink') || type.includes('toilet') || type.includes('lav')) {
        increment('P');
      }
    });

    (content.ducts || []).forEach(() => increment('M'));

    (content.fixtures || []).forEach((fixture) => {
      const type = fixture.type?.toLowerCase() || '';
      if (type.includes('panel') || type.includes('light') || type.includes('switch')) {
        increment('E');
      }
    });

    const requested = new Set(
      requestedDisciplines.map((d) => d.toUpperCase()).filter((d) => ['A', 'P', 'M', 'E'].includes(d)),
    );

    let bestDiscipline: keyof typeof scores = 'A';
    let bestScore = -Infinity;
    Object.entries(scores).forEach(([key, value]) => {
      const score = value + (requested.has(key as keyof typeof scores) ? 2 : 0);
      if (score > bestScore) {
        bestScore = score;
        bestDiscipline = key as keyof typeof scores;
      }
    });

    return bestDiscipline;
  }

  private detectViewType(content: VisionAnalysisResult): string {
    if (content.sections && content.sections.length > 0) {
      return 'SECTION';
    }
    if (content.elevations && content.elevations.length > 0) {
      return 'ELEVATION';
    }
    if (content.risers && content.risers.length > 0) {
      return 'RISER';
    }
    if (content.rooms && content.rooms.length > 0) {
      return 'PLAN';
    }
    return 'UNKNOWN';
  }

  private generateSummary(pages: PlanAnalysisPageResult[]): PlanAnalysisSummary {
    return pages.reduce<PlanAnalysisSummary>(
      (acc, page) => {
        acc.rooms += page.features.rooms?.length || 0;
        acc.walls += page.features.walls?.length || 0;
        acc.openings += page.features.openings?.length || 0;
        acc.pipes += page.features.pipes?.length || 0;
        acc.ducts += page.features.ducts?.length || 0;
        acc.fixtures += page.features.fixtures?.length || 0;
        return acc;
      },
      { rooms: 0, walls: 0, openings: 0, pipes: 0, ducts: 0, fixtures: 0 },
    );
  }
}

