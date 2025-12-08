import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '@/common/prisma/prisma.service';
import { FilesService } from '../files/files.service';
import { PdfIngestService } from './pdf-ingest.service';
import { DwgIngestService } from './dwg-ingest.service';
import { BimIngestService } from './bim-ingest.service';

export interface IngestResult {
  jobId?: string;
  fileId: string;
  sheets: SheetData[];
  rawPages?: RawPage[];
  metadata: {
    totalPages: number;
    detectedDisciplines: string[];
    fileType: string;
  };
}

export interface RawPage {
  index: number;
  text: string;
  imagePath?: string;
  widthPx?: number;
  heightPx?: number;
}

export interface SheetData extends RawPage {
  index: number;
  name?: string;
  discipline?: string;
  scale?: string;
  units?: string;
  sheetIdGuess?: string;
  widthPx?: number;
  heightPx?: number;
  imagePath?: string;
  pageSize?: {
    widthPt: number;
    heightPt: number;
  };
  renderDpi?: number;
  content: {
    rasterData?: Buffer;
    vectorData?: any;
    textData?: any;
    layerData?: any;
    modelData?: any;
    metadata?: Record<string, any>;
  };
  classification?: SheetClassificationMetadata;
}

export interface SheetClassificationMetadata {
  sheetId?: string | null;
  title?: string | null;
  discipline: string[];
  category:
    | 'site'
    | 'demo_floor'
    | 'floor'
    | 'fixture'
    | 'rcp'
    | 'elevations'
    | 'sections'
    | 'materials'
    | 'furniture'
    | 'artwork'
    | 'rr_details'
    | 'other';
  confidence?: number | null;
  notes?: string | null;
  isPrimaryPlan?: boolean | null;
}

@Injectable()
export class IngestService {
  private readonly logger = new Logger(IngestService.name);

  constructor(
    private prisma: PrismaService,
    private filesService: FilesService,
    private pdfIngestService: PdfIngestService,
    private dwgIngestService: DwgIngestService,
    private bimIngestService: BimIngestService,
  ) {}

  async ingestFile(
    fileId: string,
    disciplines: string[],
    options?: any,
    cancellationCheck?: () => void,
    jobId?: string
  ): Promise<IngestResult> {
    this.logger.log(`🚀 Starting file ingest: ${fileId}`);
    
    // Check cancellation before starting
    cancellationCheck?.();

    // Get file information
    this.logger.log(`📋 Fetching file metadata from database...`);
    const file = await this.filesService.getFile(fileId);
    this.logger.log(`📋 File info: ${file.filename}, mime=${file.mime}, size=${file.size} bytes`);
    
    // Check cancellation before download
    cancellationCheck?.();
    
    this.logger.log(`📥 Downloading file buffer from storage...`);
    const downloadStart = Date.now();
    const fileBuffer = await this.filesService.getFileBuffer(fileId);
    this.logger.log(`✅ File buffer downloaded: ${(fileBuffer.length / 1024 / 1024).toFixed(2)} MB in ${Date.now() - downloadStart}ms`);
    
    // Check cancellation after download
    cancellationCheck?.();

    // Route to appropriate ingest service based on MIME type
    let result: IngestResult;

    switch (file.mime) {
      case 'application/pdf':
        result = await this.pdfIngestService.ingest(fileId, fileBuffer, disciplines, options);
        break;
      
      case 'image/vnd.dwg':
      case 'application/vnd.dwg':
        result = await this.dwgIngestService.ingest(fileId, fileBuffer, disciplines, options);
        break;
      
      case 'model/vnd.ifc':
      case 'application/vnd.revit':
        result = await this.bimIngestService.ingest(fileId, fileBuffer, disciplines, options);
        break;
      
      default:
        throw new BadRequestException(`Unsupported file type: ${file.mime}`);
    }

    // Save sheet information to database
    await this.saveSheetData(fileId, result.sheets);

    this.logger.log(`File ingest completed: ${fileId}, ${result.sheets.length} sheets processed`);
    return result;
  }

  private async saveSheetData(fileId: string, sheets: SheetData[]): Promise<void> {
    // Find the job associated with this file
    const job = await this.prisma.job.findFirst({
      where: { fileId },
      orderBy: { createdAt: 'desc' },
    });

    if (!job) {
      this.logger.warn(`No job found for file ${fileId}`);
      return;
    }

    // Create or update sheet records per index
    for (const sheet of sheets) {
      await this.prisma.sheet.upsert({
        where: {
          jobId_index: {
            jobId: job.id,
            index: sheet.index,
          },
        },
        update: {
          name: sheet.name,
          discipline: sheet.discipline,
          scale: sheet.scale,
          units: sheet.units,
        },
        create: {
          jobId: job.id,
          index: sheet.index,
          name: sheet.name,
          discipline: sheet.discipline,
          scale: sheet.scale,
          units: sheet.units,
        },
      });
    }
  }

  async detectDiscipline(sheetName: string, content: any): Promise<string | undefined> {
    if (!sheetName) return undefined;

    // Common discipline indicators in sheet names
    const disciplinePatterns = {
      'A': /^A[\d\.-]|ARCH|FLOOR|PLAN|ELEVATION|SECTION/i,
      'P': /^P[\d\.-]|PLUMB|WATER|SEWER|DRAIN/i,
      'M': /^M[\d\.-]|MECH|HVAC|AIR|VENT/i,
      'E': /^E[\d\.-]|ELEC|POWER|LIGHT|PANEL/i,
    };

    for (const [discipline, pattern] of Object.entries(disciplinePatterns)) {
      if (pattern.test(sheetName)) {
        return discipline;
      }
    }

    return undefined;
  }

  async detectScale(content: any): Promise<{ scale?: string; units?: string }> {
    // This would implement OCR and pattern matching to detect scale
    // from title blocks and dimension strings
    
    // Common scale patterns
    const scalePatterns = [
      /(\d+\/\d+)"\s*=\s*(\d+)'-(\d+)"/g, // 1/4" = 1'-0"
      /(\d+:\d+)/g, // 1:100
      /SCALE\s*:?\s*([^\n\r]+)/gi,
    ];

    // Mock implementation - would use actual OCR results
    return {
      scale: "1/4\"=1'-0\"",
      units: "ft",
    };
  }
}
