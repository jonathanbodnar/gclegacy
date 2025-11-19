import { Injectable, Logger } from '@nestjs/common';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { IngestResult, SheetData, RawPage } from './ingest.service';
import {
  renderPdfPageFromPath,
  extractPdfPageText,
  getPdfInfoFromPath,
} from '../../common/pdf/pdf-renderer';

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
      const tempPdfPath = await this.saveTempPdf(fileBuffer);
      const pdfInfo = await getPdfInfoFromPath(tempPdfPath);
      const renderDpi = parseInt(process.env.PDF_RENDER_DPI || '220', 10);
      const sheets: SheetData[] = [];
      const rawPages: RawPage[] = [];

      try {
        for (let i = 0; i < pdfInfo.pages; i++) {
          const pageNumber = i + 1;
          const pageText = await extractPdfPageText(tempPdfPath, pageNumber);

          const sheetIdGuess = this.extractSheetName(pageText);

          const renderedImage = await renderPdfPageFromPath(
            tempPdfPath,
            pageNumber,
            renderDpi,
          );
          const imagePath = await this.saveTempImage(renderedImage.buffer);
          const { widthPx, heightPx } = renderedImage;

          // Detect discipline from page content
          const discipline = this.detectDisciplineFromText(pageText);

          // Detect scale from page content
          const scaleInfo = this.detectScaleFromText(pageText);

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
            pageSize: pdfInfo.pageSize,
            renderDpi,
            content: {
              textData: pageText,
              rasterData: renderedImage.buffer,
              metadata: {
                widthPx,
                heightPx,
                imagePath,
                pageSize: pdfInfo.pageSize,
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
      } finally {
        await fs.unlink(tempPdfPath).catch(() => undefined);
      }

      const detectedDisciplines = [...new Set(sheets.map(s => s.discipline).filter(Boolean))];

      return {
        fileId,
        sheets,
        rawPages,
        metadata: {
          totalPages: pdfInfo.pages,
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

  private async saveTempImage(buffer: Buffer): Promise<string> {
    const tempImagePath = join(tmpdir(), `sheet_image_${randomUUID()}.png`);
    await fs.writeFile(tempImagePath, buffer);
    return tempImagePath;
  }

  private async saveTempPdf(buffer: Buffer): Promise<string> {
    const tempPdfPath = join(tmpdir(), `uploaded_pdf_${randomUUID()}.pdf`);
    await fs.writeFile(tempPdfPath, buffer);
    return tempPdfPath;
  }
}
