import { Injectable, Logger } from "@nestjs/common";
import { createRequire } from "module";
import {
  OpenAIVisionService,
  VisionAnalysisResult,
} from "./openai-vision.service";
import { renderPdfToImages } from "../../common/pdf/pdf-renderer";

@Injectable()
export class PlanAnalysisService {
  private readonly logger = new Logger(PlanAnalysisService.name);

  constructor(private openaiVision: OpenAIVisionService) {}

  /**
   * Wraps a promise with a timeout to prevent indefinite hanging
   */
  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    errorMessage: string
  ): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(errorMessage)), timeoutMs)
      ),
    ]);
  }

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
    // Only log start in development - progress is reported via callback
    if (process.env.NODE_ENV !== "production") {
      this.logger.log(`Starting plan analysis for ${fileName}`);
    }

    try {
      // Convert PDF pages or plan sheets to images for vision analysis
      // Skip visual analysis entirely - rendering doesn't work on Railway
      // Return empty results for now - user needs to migrate to Render.com or similar
      this.logger.warn(`⚠️  Plan analysis skipped - PDF rendering not supported on Railway`);
      this.logger.warn(`⚠️  To enable visual analysis, migrate backend to Render.com or similar platform`);
      
      return {
        pages: [],
        summary: {
          totalPages: 0,
          analyzedPages: 0,
          message: 'Visual analysis unavailable - text extraction completed during ingestion'
        }
      };

      // Process pages in parallel batches with increased concurrency
      // Increased default batch size from 5 to 10 for better throughput
      const batchSize = parseInt(process.env.VISION_BATCH_SIZE || "10", 10);
      const results: any[] = [];
      let completedCount = 0;

      // Process all pages in batches with controlled concurrency
      for (let i = 0; i < images.length; i += batchSize) {
        const batch = images.slice(i, i + batchSize);
        const batchNumber = Math.floor(i / batchSize) + 1;
        const totalBatches = Math.ceil(images.length / batchSize);

        // Force logging for debugging
        this.logger.log(
          `Processing batch ${batchNumber}/${totalBatches} (pages ${i + 1}-${Math.min(i + batchSize, images.length)})`
        );

        // Process this batch in parallel
        const batchPromises = batch.map(async (imageBuffer, batchIndex) => {
          const pageIndex = i + batchIndex;

          try {
            // Use OpenAI Vision to analyze each page (scale is already included in the result)
            const pageResult = await this.openaiVision.analyzePlanImage(
              imageBuffer,
              disciplines,
              targets,
              options
            );

            // Use scale from the main analysis result (no need for separate API call - saves 50% of API calls!)
            const scaleInfo = pageResult.scale || {
              detected: "Unknown",
              units: "ft" as const,
              ratio: 1,
              confidence: "low" as const,
              method: "assumed" as const,
            };

            // Extract sheet title from vision analysis, fallback to generated name
            const sheetTitle =
              pageResult.sheetTitle || `${fileName}_page_${pageIndex + 1}`;

            completedCount++;

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
            completedCount++;
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

        // Only log batch completion in development
        if (process.env.NODE_ENV !== "production") {
          this.logger.log(
            `Completed batch ${batchNumber}/${totalBatches} - Total analyzed: ${results.length}/${images.length}`
          );
        }

        // Report progress via callback if provided
        if (progressCallback) {
          await progressCallback(
            completedCount,
            images.length,
            `Analyzing plans: ${completedCount}/${images.length} pages completed`
          );
        }
      }

      // Ensure results are sorted by page index
      results.sort((a, b) => a.pageIndex - b.pageIndex);

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
      // Only log page count in development
      if (process.env.NODE_ENV !== "production") {
        this.logger.log(
          `PDF has ${totalPages} total pages - will process all pages`
        );
      }
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
        // Only log render success in development
        if (process.env.NODE_ENV !== "production") {
          this.logger.log(
            `Successfully rendered ${rendered.length} pages from PDF via pdfjs/canvas`
          );
        }
        return rendered.map((page) => page.buffer);
      } else {
        this.logger.warn(
          `PDF rendering completed but no pages were generated. This may be due to XFA parsing errors or other PDF structure issues.`
        );
        // Return empty array instead of throwing - let the caller handle it
        return [];
      }
    } catch (renderError: any) {
      // Check if it's an XFA-related error
      if (
        renderError?.message &&
        (renderError.message.includes("XFA") ||
          renderError.message.includes("rich text"))
      ) {
        this.logger.warn(
          `PDF rendering encountered XFA parsing errors: ${renderError.message}. Some pages may not be processable.`
        );
        // Return empty array to allow processing to continue with other methods
        return [];
      }
      this.logger.error(
        `Canvas-based PDF rendering failed: ${renderError.message}`
      );
      throw new Error(
        "PDF conversion failed: Unable to render pages with pdfjs/canvas. Ensure the '@napi-rs/canvas' dependency is installed."
      );
    }

    throw new Error("PDF conversion failed: No images were generated");
  }

  private async getPdfPageCount(pdfBuffer: Buffer): Promise<number> {
    const nodeRequire = createRequire(__filename);
    const errors: string[] = [];
    let pdfjsLib: any;

    // Try CommonJS require first (works for pdfjs-dist 3.x)
    try {
      pdfjsLib = nodeRequire("pdfjs-dist/legacy/build/pdf.js");
      if (pdfjsLib && typeof pdfjsLib.getDocument === "function") {
        // Success, continue below
      } else {
        throw new Error("Module loaded but getDocument is not a function");
      }
    } catch (legacyError: any) {
      errors.push(`legacy build require failed: ${legacyError.message}`);

      // Try build/pdf.js (CommonJS build)
      try {
        pdfjsLib = nodeRequire("pdfjs-dist/build/pdf.js");
        if (!pdfjsLib || typeof pdfjsLib.getDocument !== "function") {
          throw new Error("Module loaded but getDocument is not a function");
        }
      } catch (requireError: any) {
        errors.push(`build/pdf.js require failed: ${requireError.message}`);

        // Try ES Module import (for pdfjs-dist 4.x if upgraded)
        try {
          const pdfjsModule = await import("pdfjs-dist");
          pdfjsLib = pdfjsModule.default || pdfjsModule;
          if (!pdfjsLib || typeof pdfjsLib.getDocument !== "function") {
            throw new Error("Module loaded but getDocument is not a function");
          }
        } catch (importError: any) {
          errors.push(`ES module import failed: ${importError.message}`);
          throw new Error(
            `Could not load pdfjs-dist. Attempted paths:\n${errors.join("\n")}\n\n` +
              `Please ensure pdfjs-dist is installed: npm install pdfjs-dist`
          );
        }
      }
    }

    // Now use pdfjsLib to get page count
    if (!pdfjsLib) {
      throw new Error("pdfjs-dist library could not be loaded");
    }

    try {
      const loadingTask = pdfjsLib.getDocument({
        data: new Uint8Array(pdfBuffer),
      });

      const pdfDoc = await loadingTask.promise;
      return pdfDoc.numPages;
    } catch (error: any) {
      this.logger.warn(
        `Failed to get PDF page count: ${error?.message || String(error)}`
      );
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
