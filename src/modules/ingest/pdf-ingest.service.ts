import { Injectable, Logger } from '@nestjs/common';
import * as pdfParse from 'pdf-parse';
import { IngestResult, SheetData } from './ingest.service';

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
      // Parse PDF to get basic information
      const pdfData = await pdfParse(fileBuffer);
      
      // Extract pages as sheets
      const sheets: SheetData[] = [];
      
      for (let i = 0; i < pdfData.numpages; i++) {
        const pageNumber = i + 1;
        
        // Extract text content for this page
        const pageText = await this.extractPageText(fileBuffer, i);
        
        // Detect discipline from page content
        const discipline = this.detectDisciplineFromText(pageText);
        
        // Detect scale from page content
        const scaleInfo = this.detectScaleFromText(pageText);
        
        // Create sheet data
        const sheet: SheetData = {
          index: i,
          name: this.extractSheetName(pageText) || `Page ${pageNumber}`,
          discipline,
          scale: scaleInfo.scale,
          units: scaleInfo.units,
          content: {
            textData: pageText,
            // rasterData would be generated from PDF page rendering
            // vectorData would be extracted from PDF vector content
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
    }
  }

  private async extractPageText(pdfBuffer: Buffer, pageIndex: number): Promise<string> {
    // This is a simplified implementation
    // In practice, you'd use a more sophisticated PDF parser that can extract text per page
    const pdfData = await pdfParse(pdfBuffer);
    return pdfData.text; // This gets all text, not per-page
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
}
