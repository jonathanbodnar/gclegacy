import { Injectable, Logger } from '@nestjs/common';
import * as pdfParse from 'pdf-parse';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { IngestResult, SheetData, RawPage } from './ingest.service';
import { renderPdfPage, getPdfJsLib } from '../../common/pdf/pdf-renderer';

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

    let tempPdfPath: string | null = null;
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

      // Prepare pdf2pic converter for raster images
      const converterInfo = await this.createPdfConverter(fileBuffer);
      const { convert, tempPdfPath: tempPath, density } = converterInfo;
      tempPdfPath = tempPath;

      const sheets: SheetData[] = [];

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

        const rasterResult = await this.renderPageImage(convert, pageNumber);
        const { widthPx, heightPx } = await this.measureImage(rasterResult.buffer);
        const imagePath = rasterResult.path;

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
          widthPx,
          heightPx,
          imagePath,
          pageSize,
          renderDpi: density,
          content: {
            textData: pageText,
            rasterData: rasterResult.buffer,
            metadata: {
              widthPx,
              heightPx,
              imagePath,
              pageSize,
              renderDpi: density,
            },
          },
        };
        
        sheets.push(sheet);
      }

      const detectedDisciplines = [...new Set(sheets.map(s => s.discipline).filter(Boolean))];

      return {
        fileId,
        sheets,
        metadata: {
          totalPages: pdfData.numpages,
          detectedDisciplines,
          fileType: 'PDF',
        },
      };

    } catch (error) {
      this.logger.error(`Error processing PDF ${fileId}:`, error);
      throw error;
    } finally {
      if (tempPdfPath) {
        await fs.unlink(tempPdfPath).catch(() => undefined);
      }
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

  private async createPdfConverter(fileBuffer: Buffer): Promise<{
    convert: (page: number, options?: any) => Promise<any>;
    tempPdfPath: string;
    density: number;
  }> {
    const pdf2picModule = await import('pdf2pic');
    const pdf2pic = pdf2picModule.default || pdf2picModule;
    const tempDir = tmpdir();
    const tempPdfPath = join(tempDir, `pdf_preprocess_${randomUUID()}.pdf`);
    await fs.writeFile(tempPdfPath, fileBuffer);

    const density = parseInt(process.env.PDF_RENDER_DPI || '220', 10);
    const convert = pdf2pic.fromPath(tempPdfPath, {
      density,
      format: 'png',
      width: parseInt(process.env.PDF_RENDER_WIDTH || '2200', 10),
      height: parseInt(process.env.PDF_RENDER_HEIGHT || '3400', 10),
      preserveAspectRatio: true,
      saveFilename: `sheet_${randomUUID()}`,
      savePath: tempDir,
    });

    return { convert, tempPdfPath, density };
  }

  private async renderPageImage(convert: any, pageNumber: number): Promise<{ buffer: Buffer; path: string }> {
    let result: any;
    try {
      result = await convert(pageNumber, { responseType: 'buffer' });
    } catch (error) {
      result = await convert(pageNumber, { responseType: 'image' });
    }

    let buffer: Buffer | null = null;
    if (result?.buffer && Buffer.isBuffer(result.buffer)) {
      buffer = result.buffer;
    } else if (result?.base64 && typeof result.base64 === 'string') {
      buffer = Buffer.from(result.base64, 'base64');
    } else if (result?.path) {
      buffer = await fs.readFile(result.path);
    }

    if (!buffer || buffer.length === 0) {
      throw new Error('pdf2pic failed to render page image. Ensure GraphicsMagick/ImageMagick are installed.');
    }

    const tempImagePath = join(tmpdir(), `sheet_image_${randomUUID()}.png`);
    await fs.writeFile(tempImagePath, buffer);
    return { buffer, path: tempImagePath };
  }

  private async measureImage(buffer: Buffer): Promise<{ widthPx: number; heightPx: number }> {
    let sharpModule: any;
    try {
      sharpModule = require('sharp');
    } catch {
      throw new Error('Sharp module is required to analyze page images. Please install: npm install sharp');
    }

    const metadata = await sharpModule(buffer).metadata();
    return {
      widthPx: metadata.width || 0,
      heightPx: metadata.height || 0,
    };
  }
}
