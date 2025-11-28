import { SheetModel } from '../../models/sheet.model';
import { JobDocument } from '../../models/job.model';
import { FileDocument } from '../../models/file.model';
import { logger as appLogger } from '../../utils/logger';
import { PdfIngestService } from './pdf-ingest.service';
import { IngestResult, SheetData } from '../../types/vision';

const scopedLogger = (scope: string) => ({
  info: (message: string, payload?: unknown) => appLogger.info(`[${scope}] ${message}`, payload),
  warn: (message: string, payload?: unknown) => appLogger.warn(`[${scope}] ${message}`, payload),
  error: (message: string, payload?: unknown) => appLogger.error(`[${scope}] ${message}`, payload),
});

export class IngestService {
  private readonly logger = scopedLogger('IngestService');
  private readonly pdfIngestService: PdfIngestService;

  constructor(deps?: { pdfIngestService?: PdfIngestService }) {
    this.pdfIngestService = deps?.pdfIngestService ?? new PdfIngestService();
  }

  async ingestFile(
    job: JobDocument & { file: FileDocument },
    fileBuffer: Buffer,
    disciplines: string[],
    options?: Record<string, unknown>,
  ): Promise<IngestResult> {
    if (!job.file) {
      throw new Error('Job is missing file information');
    }

    let result: IngestResult;
    switch (job.file.mimeType) {
      case 'application/pdf':
        result = await this.pdfIngestService.ingest(
          job.file._id.toString(),
          fileBuffer,
          disciplines,
          options,
        );
        break;
      default:
        throw new Error(`Unsupported file type: ${job.file.mimeType}`);
    }

    await this.saveSheetData(job._id.toString(), result.sheets);
    return result;
  }

  private async saveSheetData(jobId: string, sheets: SheetData[]): Promise<void> {
    const operations = sheets.map((sheet) =>
      SheetModel.findOneAndUpdate(
        { job: jobId, index: sheet.index },
        {
          $set: {
            name: sheet.name,
            discipline: sheet.discipline,
            scale: sheet.scale,
            units: sheet.units,
            metadata: {
              ...(sheet.content?.metadata || {}),
              sheetIdGuess: sheet.sheetIdGuess,
            },
          },
        },
        { upsert: true, new: true },
      ).exec(),
    );

    try {
      await Promise.all(operations);
    } catch (error) {
      this.logger.error(
        `Failed to persist sheet metadata: ${error instanceof Error ? error.message : error}`,
      );
    }
  }
}

