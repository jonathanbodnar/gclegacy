import { Injectable, Logger } from '@nestjs/common';
import * as pdfParse from 'pdf-parse';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
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
      // Parse PDF for quick metadata
      const pdfData = await pdfParse(fileBuffer);

      // Load pdfjs for per-page text and dimensions
      const pdfjsLib = await getPdfJsLib();
      const loadingTask = pdfjsLib.getDocument({
        data: new Uint8Array(fileBuffer),
        disableWorker: true,
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

    } catch (error) {
      this.logger.error(`Error processing PDF ${fileId}:`, error);
      throw error;
    }
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
