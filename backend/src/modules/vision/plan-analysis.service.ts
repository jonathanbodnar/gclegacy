  import { Injectable, Logger } from "@nestjs/common";
import {
  OpenAIVisionService,
  VisionAnalysisResult,
} from "./openai-vision.service";
import {
  renderPdfToImages,
  getPdfPageCount as getPdfPageCountFromRenderer,
} from "../../common/pdf/pdf-renderer";

@Injectable()
export class PlanAnalysisService {
  private readonly logger = new Logger(PlanAnalysisService.name);

  constructor(private openaiVision: OpenAIVisionService) {}

  async analyzePlanFile(
    fileBuffer: Buffer,
    fileName: string,
    disciplines: string[],
    targets: string[],
    options?: any,
    progressCallback?: (
      current: number,
      total: number,
      message: string
    ) => Promise<void>
  ): Promise<any> {
    this.logger.log(`Starting plan analysis for ${fileName}`);

    try {
      // Convert PDF pages or plan sheets to images for vision analysis
      const images = await this.convertToImages(fileBuffer, fileName);

      this.logger.log(`Starting parallel analysis of ${images.length} pages`);

      // Process pages in parallel batches to speed up analysis
      const batchSize = parseInt(process.env.VISION_BATCH_SIZE || "5", 10);
      const results = [];

      for (let i = 0; i < images.length; i += batchSize) {
        const batch = images.slice(i, i + batchSize);
        const batchNumber = Math.floor(i / batchSize) + 1;
        const totalBatches = Math.ceil(images.length / batchSize);

        this.logger.log(
          `Processing batch ${batchNumber}/${totalBatches} (pages ${i + 1}-${Math.min(i + batchSize, images.length)})`
        );

        // Process this batch in parallel
        const batchPromises = batch.map(async (imageBuffer, batchIndex) => {
          const pageIndex = i + batchIndex;
          this.logger.log(`Analyzing page ${pageIndex + 1}/${images.length}`);

          try {
            // Use OpenAI Vision to analyze each page
            const pageResult = await this.openaiVision.analyzePlanImage(
              imageBuffer,
              disciplines,
              targets,
              options
            );

            // Detect scale for this page
            const scaleInfo = await this.openaiVision.detectScale(imageBuffer);

            // Extract sheet title from vision analysis, fallback to generated name
            const sheetTitle =
              pageResult.sheetTitle || `${fileName}_page_${pageIndex + 1}`;

            return {
              pageIndex,
              fileName: sheetTitle,
              discipline: this.detectDisciplineFromContent(
                pageResult,
                disciplines
              ),
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
            this.logger.error(
              `Failed to analyze page ${pageIndex + 1}:`,
              error.message
            );
            // Return partial result with error
            return {
              pageIndex,
              fileName: `${fileName}_page_${pageIndex + 1}`,
              discipline: "UNKNOWN",
              scale: null,
              features: {
                rooms: [],
                walls: [],
                openings: [],
                pipes: [],
                ducts: [],
                fixtures: [],
              },
              metadata: {
                error: error.message,
                analysisTimestamp: new Date().toISOString(),
              },
            };
          }
        });

        // Wait for this batch to complete
        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults);

        this.logger.log(
          `Completed batch ${batchNumber}/${totalBatches} - Total analyzed: ${results.length}/${images.length}`
        );

        // Report progress via callback if provided
        if (progressCallback) {
          await progressCallback(
            results.length,
            images.length,
            `Analyzing plans: ${results.length}/${images.length} pages completed`
          );
        }
      }

      return {
        fileName,
        totalPages: images.length,
        pages: results,
        summary: this.generateSummary(results),
      };
    } catch (error) {
      this.logger.error(`Plan analysis failed for ${fileName}:`, error.message);
      throw error;
    }
  }

  private async convertToImages(
    fileBuffer: Buffer,
    fileName: string
  ): Promise<Buffer[]> {
    const extension = fileName.split(".").pop()?.toLowerCase();

    switch (extension) {
      case "pdf":
        return this.convertPdfToImages(fileBuffer);
      case "dwg":
      case "dxf":
        return this.convertCadToImages(fileBuffer);
      case "png":
      case "jpg":
      case "jpeg":
        // Already an image
        return [fileBuffer];
      default:
        throw new Error(
          `Unsupported file extension "${extension}" - only PDF, DWG/DXF, and raster images are supported.`
        );
    }
  }

  private async convertPdfToImages(pdfBuffer: Buffer): Promise<Buffer[]> {
    // First, get the total page count from the PDF
    let totalPages = 0;
    try {
      totalPages = await this.getPdfPageCount(pdfBuffer);
      this.logger.log(
        `PDF has ${totalPages} total pages - will process all pages`
      );
    } catch (error: any) {
      this.logger.warn(
        `Failed to get PDF page count: ${error.message}. Will attempt to process pages.`
      );
    }

    const density = parseInt(process.env.PDF_RENDER_DPI || "220", 10);
    const pagesToProcess =
      totalPages > 0
        ? totalPages
        : parseInt(process.env.PDF_RENDER_MAX_PAGES || "100", 10);

    try {
      const rendered = await renderPdfToImages(pdfBuffer, {
        dpi: density,
        maxPages: pagesToProcess,
      });

      if (rendered.length > 0) {
        this.logger.log(
          `Successfully rendered ${rendered.length} pages from PDF using Poppler`
        );
        return rendered.map((page) => page.buffer);
      }
    } catch (renderError: any) {
      this.logger.error(
        `CLI-based PDF rendering failed: ${renderError.message}`
      );
      throw new Error(
        "PDF conversion failed: Unable to render pages with Poppler (pdftoppm). Ensure poppler utilities are installed."
      );
    }

    throw new Error("PDF conversion failed: No images were generated");
  }

  private async getPdfPageCount(pdfBuffer: Buffer): Promise<number> {
    try {
      return await getPdfPageCountFromRenderer(pdfBuffer);
    } catch (error: any) {
      this.logger.warn(`Failed to get PDF page count: ${error.message}`);
      throw error;
    }
  }

  private async convertCadToImages(_cadBuffer: Buffer): Promise<Buffer[]> {
    throw new Error(
      "DWG/DXF conversion is not implemented for plan analysis yet."
    );
  }

  private detectDisciplineFromContent(
    content: any,
    requestedDisciplines: string[]
  ): string {
    // Analyze the extracted content to determine the most likely discipline
    const scores = {
      A: 0,
      P: 0,
      M: 0,
      E: 0,
    };

    // Score based on feature types found
    if (content.rooms?.length > 0 || content.walls?.length > 0)
      scores["A"] += 2;
    if (content.openings?.length > 0) scores["A"] += 1;
    if (content.pipes?.length > 0) scores["P"] += 3;
    if (content.ducts?.length > 0) scores["M"] += 3;
    if (
      content.fixtures?.some((f: any) => f.type.toLowerCase().includes("light"))
    )
      scores["E"] += 2;
    if (
      content.fixtures?.some((f: any) =>
        ["toilet", "sink", "faucet"].some((t) =>
          f.type.toLowerCase().includes(t)
        )
      )
    )
      scores["P"] += 2;

    // Return the highest scoring discipline that was requested
    const sortedDisciplines = Object.entries(scores)
      .filter(([discipline]) => requestedDisciplines.includes(discipline))
      .sort(([, a], [, b]) => b - a);

    return sortedDisciplines[0]?.[0] || requestedDisciplines[0] || "A";
  }

  private detectViewType(
    content: VisionAnalysisResult
  ): "plan" | "vertical" | "mixed" {
    const hasVertical =
      (content.elevations?.length || 0) > 0 ||
      (content.sections?.length || 0) > 0 ||
      (content.risers?.length || 0) > 0;
    const hasPlan =
      (content.rooms?.length || 0) > 0 ||
      (content.walls?.length || 0) > 0 ||
      (content.openings?.length || 0) > 0;

    if (hasVertical && hasPlan) return "mixed";
    if (hasVertical) return "vertical";
    return "plan";
  }

  private generateSummary(pageResults: any[]): any {
    const summary = {
      totalRooms: 0,
      totalWallLength: 0,
      totalPipeLength: 0,
      totalDuctLength: 0,
      totalFixtures: 0,
      totalElevations: 0,
      totalSections: 0,
      totalRisers: 0,
      totalRiserHeight: 0,
      disciplines: new Set<string>(),
      levelsMap: new Map<string, { elevationFt?: number; heightFt?: number }>(),
      defaultStoryHeightFt: undefined as number | undefined,
    };

    for (const page of pageResults) {
      const features = page.features as VisionAnalysisResult;

      summary.totalRooms += features.rooms?.length || 0;
      summary.totalWallLength +=
        features.walls?.reduce(
          (sum: number, w: any) => sum + (w.length || 0),
          0
        ) || 0;
      summary.totalPipeLength +=
        features.pipes?.reduce(
          (sum: number, p: any) => sum + (p.length || 0),
          0
        ) || 0;
      summary.totalDuctLength +=
        features.ducts?.reduce(
          (sum: number, d: any) => sum + (d.length || 0),
          0
        ) || 0;
      summary.totalFixtures +=
        features.fixtures?.reduce(
          (sum: number, f: any) => sum + (f.count || 0),
          0
        ) || 0;

      summary.totalElevations += features.elevations?.length || 0;
      summary.totalSections += features.sections?.length || 0;
      summary.totalRisers += features.risers?.length || 0;
      summary.totalRiserHeight +=
        features.risers?.reduce(
          (sum: number, r: any) => sum + (r.heightFt || 0),
          0
        ) || 0;

      if (
        !summary.defaultStoryHeightFt &&
        features.verticalMetadata?.defaultStoryHeightFt
      ) {
        summary.defaultStoryHeightFt =
          features.verticalMetadata.defaultStoryHeightFt;
      }

      features.levels?.forEach((level) => {
        const key = level.name || level.id;
        if (!summary.levelsMap.has(key)) {
          summary.levelsMap.set(key, {
            elevationFt: level.elevationFt,
            heightFt: level.heightFt,
          });
        }
      });

      if (page.discipline) {
        summary.disciplines.add(page.discipline);
      }
    }

    return {
      totalRooms: summary.totalRooms,
      totalWallLength: summary.totalWallLength,
      totalPipeLength: summary.totalPipeLength,
      totalDuctLength: summary.totalDuctLength,
      totalFixtures: summary.totalFixtures,
      totalElevations: summary.totalElevations,
      totalSections: summary.totalSections,
      totalRisers: summary.totalRisers,
      totalRiserHeight: summary.totalRiserHeight,
      defaultStoryHeightFt: summary.defaultStoryHeightFt,
      disciplines: Array.from(summary.disciplines),
      levels: Array.from(summary.levelsMap.entries()).map(([name, data]) => ({
        name,
        ...data,
      })),
    };
  }
}
