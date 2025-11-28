import { createRequire } from 'module';

import { renderPdfPage } from '../../common/pdf/pdf-renderer';
import { logger as appLogger } from '../../utils/logger';
import { IngestResult, SheetData, RawPage } from '../../types/vision';

const scopedLogger = (scope: string) => ({
  info: (message: string, payload?: unknown) => appLogger.info(`[${scope}] ${message}`, payload),
  warn: (message: string, payload?: unknown) => appLogger.warn(`[${scope}] ${message}`, payload),
  error: (message: string, payload?: unknown) => appLogger.error(`[${scope}] ${message}`, payload),
});

export class PdfIngestService {
  private readonly logger = scopedLogger('PdfIngestService');

  async ingest(
    fileId: string,
    fileBuffer: Buffer,
    _disciplines: string[],
    _options?: Record<string, unknown>,
  ): Promise<IngestResult> {
    const pdfjs = await this.loadPdfJs();
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(fileBuffer),
      stopAtErrors: true,
    });
    const pdfDoc = await loadingTask.promise;

    const renderDpi = parseInt(process.env.PDF_RENDER_DPI || '220', 10);
    const maxPagesEnv = parseInt(process.env.PDF_RENDER_MAX_PAGES || '0', 10);
    const limit = maxPagesEnv > 0 ? Math.min(maxPagesEnv, pdfDoc.numPages) : pdfDoc.numPages;

    const sheets: SheetData[] = [];
    const rawPages: RawPage[] = [];
    const detectedDisciplines = new Set<string>();

    for (let index = 0; index < limit; index += 1) {
      const pageNumber = index + 1;
      try {
        const page = await pdfDoc.getPage(pageNumber);
        const pageText = await this.extractPageText(page);
        const sheetIdGuess = this.extractSheetName(pageText);
        const discipline = this.detectDisciplineFromText(pageText);
        if (discipline) {
          detectedDisciplines.add(discipline);
        }
        const scaleInfo = this.detectScaleFromText(pageText);

        const viewport = page.getViewport({ scale: 1 });
        const pageSize = {
          widthPt: viewport.width,
          heightPt: viewport.height,
        };

        let widthPx = 0;
        let heightPx = 0;
        let rasterBuffer: Buffer | undefined;
        try {
          const rendered = await renderPdfPage(page, { dpi: renderDpi });
          rasterBuffer = rendered.buffer;
          widthPx = rendered.widthPx;
          heightPx = rendered.heightPx;
        } catch (renderError) {
          this.logger.warn(
            `Failed to render page ${pageNumber}/${pdfDoc.numPages}: ${renderError instanceof Error ? renderError.message : renderError}`,
          );
          const scaledViewport = page.getViewport({ scale: renderDpi / 72 });
          widthPx = Math.round(scaledViewport.width);
          heightPx = Math.round(scaledViewport.height);
        }

        const sheet: SheetData = {
          index,
          name: sheetIdGuess || `Page ${pageNumber}`,
          discipline,
          scale: scaleInfo.scale,
          units: scaleInfo.units,
          sheetIdGuess,
          text: pageText,
          widthPx,
          heightPx,
          pageSize,
          renderDpi,
          content: {
            rasterData: rasterBuffer,
            textData: pageText,
            metadata: {
              pageSize,
              renderDpi,
              widthPx,
              heightPx,
            },
          },
        };

        const rawPage: RawPage = {
          index,
          text: pageText,
          widthPx,
          heightPx,
        };

        sheets.push(sheet);
        rawPages.push(rawPage);
      } catch (error) {
        this.logger.warn(
          `Failed to process page ${pageNumber}/${pdfDoc.numPages}: ${
            error instanceof Error ? error.message : error
          }`,
        );
      }
    }

    return {
      fileId,
      sheets,
      rawPages,
      metadata: {
        totalPages: pdfDoc.numPages,
        detectedDisciplines: Array.from(detectedDisciplines),
        fileType: 'application/pdf',
      },
    };
  }

  private async extractPageText(page: any): Promise<string> {
    try {
      const textContent = await page.getTextContent();
      return textContent.items.map((item: any) => ('str' in item ? item.str : '')).join('\n');
    } catch (error) {
      this.logger.warn(
        `Failed to extract text content: ${error instanceof Error ? error.message : error}`,
      );
      return '';
    }
  }

  private extractSheetName(text: string): string | undefined {
    if (!text) return undefined;
    const match = text.match(/(SHEET\s*NO\.?|DRAWING\s*NO\.?|SHEET)\s*[:#]?\s*([A-Z0-9\.-]+)/i);
    if (match && match[2]) {
      return match[2].trim();
    }
    const altMatch = text.match(/([A-Z]{1,2}-\d{1,3}[\.\dA-Z]*)/);
    return altMatch?.[1];
  }

  private detectDisciplineFromText(text: string): string | undefined {
    if (!text) return undefined;
    const disciplinePatterns: Record<string, RegExp> = {
      A: /(ARCHITECT|FLOOR\s*PLAN|ELEVATION|SECTION)/i,
      P: /(PLUMBING|WATER|SEWER|DRAIN)/i,
      M: /(MECHANICAL|HVAC|AIR\s*HANDLING|VENT)/i,
      E: /(ELECTRICAL|LIGHTING|PANEL|POWER)/i,
    };
    for (const [discipline, pattern] of Object.entries(disciplinePatterns)) {
      if (pattern.test(text)) {
        return discipline;
      }
    }
    return undefined;
  }

  private detectScaleFromText(text: string): { scale?: string; units?: string } {
    if (!text) return {};
    const scalePattern = /(SCALE\s*:?\s*)([^\n\r]+)/i;
    const ratioPattern = /(\d+\/\d+)"\s*=\s*(\d+)'[- ]?(\d+)?"/;
    const metricPattern = /(1:\s*\d+)/;

    const scaleMatch = text.match(scalePattern);
    if (scaleMatch && scaleMatch[2]) {
      const scaleText = scaleMatch[2].trim();
      if (ratioPattern.test(scaleText)) {
        return { scale: scaleText, units: 'ft' };
      }
      if (metricPattern.test(scaleText)) {
        return { scale: scaleText, units: 'm' };
      }
      return { scale: scaleText };
    }

    const inlineRatio = text.match(ratioPattern);
    if (inlineRatio) {
      return { scale: inlineRatio[0], units: 'ft' };
    }

    const inlineMetric = text.match(metricPattern);
    if (inlineMetric) {
      return { scale: inlineMetric[0], units: 'm' };
    }

    return {};
  }

  private async loadPdfJs(): Promise<any> {
    const nodeRequire = createRequire(__filename);
    const attempts = [
      () => nodeRequire('pdfjs-dist/legacy/build/pdf.js'),
      () => nodeRequire('pdfjs-dist/build/pdf.js'),
      async () => {
        const pdfjsModule = await import('pdfjs-dist');
        return pdfjsModule.default || pdfjsModule;
      },
    ];

    for (const attempt of attempts) {
      try {
        const lib = await attempt();
        if (lib && typeof lib.getDocument === 'function') {
          return lib;
        }
      } catch {
        // continue
      }
    }

    throw new Error('Failed to load pdfjs-dist. Ensure pdfjs-dist is installed.');
  }
}

