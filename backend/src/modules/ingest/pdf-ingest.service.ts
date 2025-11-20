import { Injectable, Logger } from '@nestjs/common';
import * as pdfParse from 'pdf-parse';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { createRequire } from 'module';
import { IngestResult, SheetData, RawPage } from './ingest.service';
import { renderPdfPage } from '../../common/pdf/pdf-renderer';

@Injectable()
export class PdfIngestService {
  private readonly logger = new Logger(PdfIngestService.name);

  async ingest(
    fileId: string,
    fileBuffer: Buffer,
    disciplines: string[],
    options?: any,
  ): Promise<IngestResult> {
    this.logger.log(`Processing PDF file: ${fileId}`);

    try {
      // Suppress XFA parsing warnings and canvas cleanup errors from pdfjs-dist
      const originalWarn = console.warn;
      const originalError = console.error;
      const suppressedWarnings = new Set<string>();
      console.warn = (...args: any[]) => {
        const message = args.join(' ');
        // Suppress known XFA parsing warnings that don't affect functionality
        if (message.includes('XFA') && message.includes('rich text')) {
          suppressedWarnings.add(message);
          return; // Suppress this warning
        }
        originalWarn.apply(console, args);
      };
      console.error = (...args: any[]) => {
        const message = args.join(' ');
        // Suppress specific canvas cleanup errors that don't affect functionality
        if (
          message.includes('Failed to unwrap exclusive reference') ||
          (message.includes('CanvasElement') && message.includes('napi value'))
        ) {
          return; // Suppress this error
        }
        originalError.apply(console, args);
      };

      try {
        // Parse PDF for quick metadata
        const pdfData = await pdfParse(fileBuffer);

        // Load pdfjs for per-page text and dimensions
        const pdfjsLib = await this.loadPdfJs();
        const loadingTask = pdfjsLib.getDocument({
          data: new Uint8Array(fileBuffer),
        });
        const pdfDoc = await loadingTask.promise;

        const renderDpi = parseInt(process.env.PDF_RENDER_DPI || '220', 10);
        const sheets: SheetData[] = [];
        const rawPages: RawPage[] = [];

        for (let i = 0; i < pdfDoc.numPages; i++) {
          const pageNumber = i + 1;
          const page = await pdfDoc.getPage(pageNumber);

          // Extract text content for this page
          const pageText = await this.extractPageTextContent(page);

          const sheetIdGuess = this.extractSheetName(pageText);

          const viewport = page.getViewport({ scale: 1 });
          const pageSize = {
            widthPt: viewport.width,
            heightPt: viewport.height,
          };

          const renderedImage = await renderPdfPage(page, { dpi: renderDpi });
          const imagePath = await this.saveTempImage(renderedImage.buffer);
          const { widthPx, heightPx } = renderedImage;

          // Detect discipline from page content
          const discipline = this.detectDisciplineFromText(pageText);
          
          // Detect scale from page content
          const scaleInfo = this.detectScaleFromText(pageText);
          
          // Create sheet data
          const sheet: SheetData = {
            index: i,
            name: sheetIdGuess || `Page ${pageNumber}`,
            discipline,
            scale: scaleInfo.scale,
            units: scaleInfo.units,
            sheetIdGuess,
            text: pageText,
            widthPx,
            heightPx,
            imagePath,
            pageSize,
            renderDpi,
            content: {
              textData: pageText,
              rasterData: renderedImage.buffer,
              metadata: {
                widthPx,
                heightPx,
                imagePath,
                pageSize,
                renderDpi,
              },
            },
          };
          
          sheets.push(sheet);
          rawPages.push({
            index: i,
            text: pageText,
            imagePath,
            widthPx,
            heightPx,
          });
        }

        const detectedDisciplines = [...new Set(sheets.map(s => s.discipline).filter(Boolean))];

        return {
          fileId,
          sheets,
          rawPages,
          metadata: {
            totalPages: pdfData.numpages,
            detectedDisciplines,
            fileType: 'PDF',
          },
        };
      } finally {
        // Restore original console.warn
        // Restore original console methods
        console.warn = originalWarn;
        console.error = originalError;
        // Log suppressed warnings count if any were suppressed
        if (suppressedWarnings.size > 0) {
          this.logger.debug(
            `Suppressed ${suppressedWarnings.size} XFA parsing warning(s) during PDF processing`
          );
        }
      }
    } catch (error) {
      this.logger.error(`Error processing PDF ${fileId}:`, error);
      throw error;
    }
  }

  private async loadPdfJs(): Promise<any> {
    const errors: string[] = [];
    const nodeRequire = createRequire(__filename);

    // Try to load canvas for configuration (optional - PDF.js can work without it for text extraction)
    let canvasLib: any = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      canvasLib = require('@napi-rs/canvas');
    } catch (canvasError: any) {
      // Canvas not available - PDF.js can still work for text extraction
      this.logger.debug('Canvas module not available, PDF rendering may fail');
    }
    
    // Helper function to configure PDF.js for Node.js environment
    const configurePdfJs = (lib: any): any => {
      if (!lib) return lib;

      try {
        // Disable worker to run in main thread (better for Node.js)
        if (lib.GlobalWorkerOptions) {
          lib.GlobalWorkerOptions.workerSrc = false;
        }

        // Try to set up canvas factory if canvas is available and API exists
        if (canvasLib && typeof lib.setCanvasFactory === 'function') {
          lib.setCanvasFactory({
            create(width: number, height: number) {
              const canvas = canvasLib.createCanvas(width, height);
              return {
                canvas: canvas,
                context: canvas.getContext('2d'),
              };
            },
            reset(canvasAndContext: any, width: number, height: number) {
              if (canvasAndContext?.canvas) {
                try {
                  canvasAndContext.canvas.width = width;
                  canvasAndContext.canvas.height = height;
                } catch (e) {
                  // Ignore reset errors
                }
              }
            },
            destroy(canvasAndContext: any) {
              // Suppress destruction errors - @napi-rs/canvas handles cleanup
              if (canvasAndContext) {
                try {
                  if (canvasAndContext.canvas && typeof canvasAndContext.canvas.width !== 'undefined') {
                    canvasAndContext.canvas.width = 0;
                    canvasAndContext.canvas.height = 0;
                  }
                } catch (e) {
                  // Silently ignore cleanup errors
                }
              }
            },
          });
        }
      } catch (configError: any) {
        // Configuration is optional
      }

      return lib;
    };

    // Try CommonJS require first (works for pdfjs-dist 3.x)
    try {
      const lib = nodeRequire('pdfjs-dist/legacy/build/pdf.js');
      if (lib && typeof lib.getDocument === 'function') {
        this.logger.debug('Successfully loaded pdfjs-dist via legacy build');
        return configurePdfJs(lib);
      }
    } catch (legacyError: any) {
      errors.push(`legacy build require failed: ${legacyError.message}`);
    }

    // Try ES Module import (for pdfjs-dist 4.x if upgraded)
    try {
      const pdfjsModule = await import('pdfjs-dist');
      const lib = pdfjsModule.default || pdfjsModule;
      
      if (lib && typeof lib.getDocument === 'function') {
        this.logger.debug('Successfully loaded pdfjs-dist via ES module import');
        return configurePdfJs(lib);
      } else {
        throw new Error('Module loaded but getDocument is not a function');
      }
    } catch (importError: any) {
      const errorMsg = importError.message || String(importError);
      errors.push(`ES module import failed: ${errorMsg}`);
    }

    // Try build/pdf.js (CommonJS build)
    try {
      const lib = nodeRequire('pdfjs-dist/build/pdf.js');
      if (lib && typeof lib.getDocument === 'function') {
        this.logger.debug('Successfully loaded pdfjs-dist via build/pdf.js');
        return configurePdfJs(lib);
      }
    } catch (requireError: any) {
      errors.push(`build/pdf.js require failed: ${requireError.message}`);
    }

    // If all attempts failed, throw a comprehensive error
    this.logger.error(`Failed to load pdfjs-dist after ${errors.length} attempts`);
    throw new Error(
      `Failed to load pdfjs-dist. Attempted paths:\n${errors.join('\n')}\n\n` +
      `Please ensure pdfjs-dist is installed: npm install pdfjs-dist\n` +
      `Recommended: Use pdfjs-dist@^3.11.0 for CommonJS compatibility`
    );
  }

  private detectDisciplineFromText(text: string): string | undefined {
    const disciplineKeywords = {
      'A': ['FLOOR PLAN', 'ARCHITECTURAL', 'ELEVATION', 'SECTION', 'ROOM', 'DOOR', 'WINDOW'],
      'P': ['PLUMBING', 'WATER', 'SEWER', 'DRAIN', 'FIXTURE', 'PIPE'],
      'M': ['MECHANICAL', 'HVAC', 'AIR CONDITIONING', 'VENTILATION', 'DUCT', 'SUPPLY', 'RETURN'],
      'E': ['ELECTRICAL', 'POWER', 'LIGHTING', 'PANEL', 'CIRCUIT', 'OUTLET', 'SWITCH'],
    };

    for (const [discipline, keywords] of Object.entries(disciplineKeywords)) {
      for (const keyword of keywords) {
        if (text.toUpperCase().includes(keyword)) {
          return discipline;
        }
      }
    }

    return undefined;
  }

  private detectScaleFromText(text: string): { scale?: string; units?: string } {
    // Look for common scale patterns
    const scalePatterns = [
      /(\d+\/\d+)"\s*=\s*(\d+)'-(\d+)"/g, // 1/4" = 1'-0"
      /(\d+):\s*(\d+)/g, // 1:100
      /SCALE\s*:?\s*([^\n\r]+)/gi,
    ];

    for (const pattern of scalePatterns) {
      const match = pattern.exec(text);
      if (match) {
        return {
          scale: match[0],
          units: match[0].includes('"') ? 'ft' : 'm',
        };
      }
    }

    return {};
  }

  private extractSheetName(text: string): string | undefined {
    // Look for sheet title patterns
    const titlePatterns = [
      /SHEET\s+([A-Z][\d\.-]+)/gi,
      /DRAWING\s+([A-Z][\d\.-]+)/gi,
      /^([A-Z][\d\.-]+)\s/gm,
    ];

    for (const pattern of titlePatterns) {
      const match = pattern.exec(text);
      if (match) {
        return match[1];
      }
    }

    return undefined;
  }

  private async extractPageTextContent(page: any): Promise<string> {
    const textContent = await page.getTextContent();
    const strings: string[] = [];
    for (const item of textContent.items || []) {
      if (typeof item.str === 'string') {
        strings.push(item.str);
      }
    }
    return strings.join(' ').replace(/\s+/g, ' ').trim();
  }

  private async saveTempImage(buffer: Buffer): Promise<string> {
    const tempImagePath = join(tmpdir(), `sheet_image_${randomUUID()}.png`);
    await fs.writeFile(tempImagePath, buffer);
    return tempImagePath;
  }
}
