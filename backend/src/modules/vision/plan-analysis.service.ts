import { Injectable, Logger } from "@nestjs/common";
import {
  OpenAIVisionService,
  VisionAnalysisResult,
} from "./openai-vision.service";
import { promises as fs } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";

@Injectable()
export class PlanAnalysisService {
  private readonly logger = new Logger(PlanAnalysisService.name);
  private static readonly PLACEHOLDER_PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=",
    "base64"
  );

  constructor(private openaiVision: OpenAIVisionService) {}

  async analyzePlanFile(
    fileBuffer: Buffer,
    fileName: string,
    disciplines: string[],
    targets: string[],
    options?: any
  ): Promise<any> {
    this.logger.log(`Starting plan analysis for ${fileName}`);

    try {
      // Convert PDF pages or plan sheets to images for vision analysis
      const images = await this.convertToImages(fileBuffer, fileName);

      this.logger.log(`Starting parallel analysis of ${images.length} pages`);

      // Process pages in parallel batches to speed up analysis
      const batchSize = parseInt(process.env.VISION_BATCH_SIZE || '5', 10);
      const results = [];

      for (let i = 0; i < images.length; i += batchSize) {
        const batch = images.slice(i, i + batchSize);
        const batchNumber = Math.floor(i / batchSize) + 1;
        const totalBatches = Math.ceil(images.length / batchSize);
        
        this.logger.log(`Processing batch ${batchNumber}/${totalBatches} (pages ${i + 1}-${Math.min(i + batchSize, images.length)})`);

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
              discipline: this.detectDisciplineFromContent(pageResult, disciplines),
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
            this.logger.error(`Failed to analyze page ${pageIndex + 1}:`, error.message);
            // Return partial result with error
            return {
              pageIndex,
              fileName: `${fileName}_page_${pageIndex + 1}`,
              discipline: 'UNKNOWN',
              scale: null,
              features: { rooms: [], walls: [], openings: [], pipes: [], ducts: [], fixtures: [] },
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

        this.logger.log(`Completed batch ${batchNumber}/${totalBatches} - Total analyzed: ${results.length}/${images.length}`);
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
        this.logger.warn(
          `Unsupported file extension "${extension}" - using placeholder image`
        );
        return [PlanAnalysisService.PLACEHOLDER_PNG];
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

    try {
      // Try extracting embedded images first using pdfjs-dist
      const buffers = await this.extractEmbeddedImagesFromPdf(pdfBuffer);

      if (buffers.length > 0) {
        this.logger.log(`Extracted ${buffers.length} embedded images from PDF`);
        // If we got embedded images but they're fewer than total pages,
        // we should still render all pages to ensure complete coverage
        if (totalPages > 0 && buffers.length < totalPages) {
          this.logger.log(
            `Only ${buffers.length} embedded images found but PDF has ${totalPages} pages. ` +
              `Rendering all pages to ensure complete coverage.`
          );
          // Continue to pdf2pic to render all pages
        } else {
          return buffers;
        }
      }
    } catch (extractError: any) {
      this.logger.warn(
        `Embedded image extraction failed: ${extractError.message}. Falling back to pdf2pic.`
      );
    }

    // Use pdf2pic for rendering full pages - process ALL pages
    const density = parseInt(process.env.PDF_RENDER_DPI || "220", 10);
    // Use totalPages if available, otherwise use a high default or env var
    const pagesToProcess =
      totalPages > 0
        ? totalPages
        : parseInt(process.env.PDF_RENDER_MAX_PAGES || "100", 10); // Default to 100 if page count unknown

    try {
      const buffers = await this.convertPdfWithPdf2Pic(
        pdfBuffer,
        density,
        pagesToProcess
      );

      if (buffers.length > 0) {
        this.logger.log(
          `Successfully converted ${buffers.length} pages from PDF to images`
        );
        return buffers;
      }
    } catch (pdf2picError: any) {
      this.logger.error(`pdf2pic conversion failed: ${pdf2picError.message}`);

      // Provide helpful error message about GraphicsMagick/ImageMagick requirement
      if (
        pdf2picError.message?.includes("ENOENT") ||
        pdf2picError.message?.includes("spawn") ||
        pdf2picError.message?.includes("write EOF")
      ) {
        throw new Error(
          "PDF conversion failed: pdf2pic requires GraphicsMagick or ImageMagick to be installed. " +
            "Please install one of these tools:\n" +
            "- Windows: Download from https://imagemagick.org/script/download.php or use: choco install imagemagick\n" +
            "- Linux: sudo apt-get install graphicsmagick or sudo apt-get install imagemagick\n" +
            "- macOS: brew install graphicsmagick or brew install imagemagick"
        );
      }

      throw pdf2picError;
    }

    // This should not be reached, but kept as fallback
    this.logger.warn("PDF conversion returned no images");
    throw new Error("PDF conversion failed: No images were generated");
  }

  private async getPdfPageCount(pdfBuffer: Buffer): Promise<number> {
    // Try different import methods based on pdfjs-dist version
    let pdfjsLib: any;
    try {
      pdfjsLib = require("pdfjs-dist");
    } catch (e) {
      try {
        pdfjsLib = require("pdfjs-dist/legacy/build/pdf.js");
      } catch (e2) {
        throw new Error(
          "Could not load pdfjs-dist. Please check installation."
        );
      }
    }

    try {
      const loadingTask = pdfjsLib.getDocument({
        data: new Uint8Array(pdfBuffer),
      });

      const pdfDoc = await loadingTask.promise;
      return pdfDoc.numPages;
    } catch (error: any) {
      this.logger.warn(`Failed to get PDF page count: ${error.message}`);
      throw error;
    }
  }

  private async extractEmbeddedImagesFromPdf(
    pdfBuffer: Buffer
  ): Promise<Buffer[]> {
    // Load sharp for image processing (works better on Windows than canvas)
    let sharp: any;
    try {
      sharp = require("sharp");
    } catch (e) {
      throw new Error(
        "Sharp module is required for PDF image extraction. Please install: npm install sharp"
      );
    }

    // Try different import methods based on pdfjs-dist version
    let pdfjsLib: any;
    try {
      pdfjsLib = require("pdfjs-dist");
    } catch (e) {
      try {
        pdfjsLib = require("pdfjs-dist/legacy/build/pdf.js");
      } catch (e2) {
        throw new Error(
          "Could not load pdfjs-dist. Please check installation."
        );
      }
    }

    const images: Buffer[] = [];

    try {
      // Load the PDF document
      const loadingTask = pdfjsLib.getDocument({
        data: new Uint8Array(pdfBuffer),
      });

      const pdfDoc = await loadingTask.promise;
      const numPages = pdfDoc.numPages;

      // Minimum image size threshold (width * height) - default 100,000 pixels
      const minImageSize = parseInt(
        process.env.PDF_MIN_IMAGE_SIZE || "100000",
        10
      );

      this.logger.log(
        `PDF has ${numPages} pages, filtering images larger than ${minImageSize} pixels`
      );

      // Collect all images with metadata
      const allImages: Array<{
        buffer: Buffer;
        size: number;
        width: number;
        height: number;
        page: number;
      }> = [];

      for (let i = 1; i <= numPages; i++) {
        const page = await pdfDoc.getPage(i);

        // Extract embedded images ONLY
        const opList = await page.getOperatorList();
        const fnArray = opList.fnArray;
        const argsArray = opList.argsArray;

        let imgCount = 0;

        for (let j = 0; j < fnArray.length; j++) {
          const fn = fnArray[j];
          const args = argsArray[j];

          // Check for image operations
          if (
            fn === pdfjsLib.OPS.paintImageXObject ||
            fn === pdfjsLib.OPS.paintInlineImageXObject ||
            fn === pdfjsLib.OPS.paintImageMaskXObject
          ) {
            const objName = args[0];

            try {
              // Get the image from the page's object storage
              const img = await new Promise<any>((resolve, reject) => {
                const timeout = setTimeout(
                  () => reject(new Error("Timeout")),
                  5000
                );

                page.objs.get(objName, (image: any) => {
                  clearTimeout(timeout);
                  if (image) {
                    resolve(image);
                  } else {
                    reject(new Error("Image not found"));
                  }
                });
              });

              if (img && img.width && img.height) {
                const imageSize = img.width * img.height;

                // Skip small images (icons, logos, etc.)
                if (imageSize < minImageSize) {
                  this.logger.debug(
                    `Skipping small image on page ${i}: ${img.width}x${img.height} (${imageSize} pixels < ${minImageSize})`
                  );
                  continue;
                }

                this.logger.log(
                  `Large image found on page ${i}: ${img.width}x${img.height} (${imageSize} pixels)`
                );

                // Convert image data to RGBA format
                let rgbaData: Uint8Array;
                let channels = 4; // RGBA

                if (img.data) {
                  const bytesPerPixel =
                    img.data.length / (img.width * img.height);

                  if (bytesPerPixel === 4) {
                    // RGBA data - direct use
                    rgbaData = new Uint8Array(img.data);
                  } else if (bytesPerPixel === 3) {
                    // RGB data - need to add alpha channel
                    rgbaData = new Uint8Array(img.width * img.height * 4);
                    for (let k = 0; k < img.width * img.height; k++) {
                      rgbaData[k * 4] = img.data[k * 3]; // R
                      rgbaData[k * 4 + 1] = img.data[k * 3 + 1]; // G
                      rgbaData[k * 4 + 2] = img.data[k * 3 + 2]; // B
                      rgbaData[k * 4 + 3] = 255; // A
                    }
                  } else if (bytesPerPixel === 1) {
                    // Grayscale - convert to RGBA
                    rgbaData = new Uint8Array(img.width * img.height * 4);
                    for (let k = 0; k < img.width * img.height; k++) {
                      const gray = img.data[k];
                      rgbaData[k * 4] = gray; // R
                      rgbaData[k * 4 + 1] = gray; // G
                      rgbaData[k * 4 + 2] = gray; // B
                      rgbaData[k * 4 + 3] = 255; // A
                    }
                  } else {
                    this.logger.warn(
                      `Unsupported bytes per pixel: ${bytesPerPixel}, skipping image`
                    );
                    continue;
                  }
                } else if (img.bitmap) {
                  // Bitmap data - assume RGBA
                  rgbaData = new Uint8Array(img.bitmap);
                } else {
                  this.logger.warn(
                    `Image has no data or bitmap property, skipping`
                  );
                  continue;
                }

                // Use sharp to convert raw RGBA data to PNG
                const embeddedImgBuffer = await sharp(rgbaData, {
                  raw: {
                    width: img.width,
                    height: img.height,
                    channels: channels,
                  },
                })
                  .png()
                  .toBuffer();

                // Store image with metadata for sorting
                allImages.push({
                  buffer: embeddedImgBuffer,
                  size: imageSize,
                  width: img.width,
                  height: img.height,
                  page: i,
                });

                this.logger.log(
                  `Extracted large image from page ${i}: ${img.width}x${img.height} (${imageSize} pixels, ${embeddedImgBuffer.length} bytes)`
                );

                imgCount++;
              }
            } catch (err: any) {
              this.logger.error(
                `Error extracting image ${objName} from page ${i}:`,
                err.message
              );
            }
          }
        }

        if (imgCount === 0) {
          this.logger.log(`No large embedded images found on page ${i}`);
        }
      }

      // Sort all images by size (largest first) and add to results
      allImages.sort((a, b) => b.size - a.size);

      for (const imgData of allImages) {
        images.push(imgData.buffer);
      }

      this.logger.log(
        `Extracted ${images.length} large images (filtered from all pages, minimum size: ${minImageSize} pixels)`
      );
    } catch (error: any) {
      this.logger.error(`Error extracting embedded images:`, error.message);
      throw error;
    }

    return images;
  }

  private async convertPdfWithPdf2Pic(
    pdfBuffer: Buffer,
    density: number,
    maxPages: number
  ): Promise<Buffer[]> {
    const pdf2picModule = await import("pdf2pic");
    const pdf2pic = pdf2picModule.default || pdf2picModule;

    // Create a temporary file for the PDF (pdf2pic works better with file paths)
    const tempDir = tmpdir();
    const tempPdfPath = join(tempDir, `pdf_${randomUUID()}.pdf`);

    try {
      // Write PDF buffer to temp file
      await fs.writeFile(tempPdfPath, pdfBuffer);

      // Use fromPath instead of fromBuffer for better compatibility
      const convert = pdf2pic.fromPath(tempPdfPath, {
        density,
        format: "png",
        width: 2048,
        height: 2048,
        preserveAspectRatio: true,
        saveFilename: `page_${randomUUID()}`,
        savePath: tempDir,
      });

      const images: Buffer[] = [];
      const totalPagesToProcess = Math.max(1, maxPages);
      let successfulPages = 0;
      let failedPages = 0;

      for (let page = 1; page <= totalPagesToProcess; page++) {
        try {
          this.logger.log(
            `Converting PDF page ${page}/${totalPagesToProcess} to image...`
          );

          // Try buffer response type first
          let result: any;
          try {
            result = await convert(page, { responseType: "buffer" });
          } catch (convertError: any) {
            // If buffer fails, try image response type
            this.logger.warn(
              `Buffer response failed for page ${page}, trying image response: ${convertError.message}`
            );
            try {
              result = await convert(page, { responseType: "image" });
            } catch (imageError: any) {
              // If both fail, try without responseType (default)
              this.logger.warn(
                `Image response failed for page ${page}, trying default: ${imageError.message}`
              );
              result = await convert(page);
            }
          }

          this.logger.debug(`pdf2pic result structure for page ${page}:`, {
            hasBuffer: !!result?.buffer,
            hasBase64: !!result?.base64,
            hasPath: !!result?.path,
            bufferSize: result?.buffer?.length || 0,
            keys: result ? Object.keys(result) : [],
          });

          let imageBuffer: Buffer | null = null;

          if (result?.buffer && Buffer.isBuffer(result.buffer)) {
            imageBuffer = result.buffer;
            this.logger.log(
              `Using buffer from result for page ${page} (${imageBuffer.length} bytes)`
            );
          } else if (result?.base64 && typeof result.base64 === "string") {
            imageBuffer = Buffer.from(result.base64, "base64");
            this.logger.log(
              `Using base64 from result for page ${page} (decoded to ${imageBuffer.length} bytes)`
            );
          } else if (result?.path && typeof result.path === "string") {
            // If buffer/base64 not available, read from file path
            this.logger.log(
              `Reading image from file for page ${page}: ${result.path}`
            );
            imageBuffer = await fs.readFile(result.path);
            // Clean up the generated image file
            await fs.unlink(result.path).catch(() => undefined);
          } else {
            // Try to find any buffer-like property
            const keys = Object.keys(result || {});
            this.logger.warn(
              `Unexpected result structure for page ${page}. Available keys: ${keys.join(", ")}`
            );

            // Try to extract buffer from result object
            for (const key of keys) {
              if (Buffer.isBuffer(result[key])) {
                imageBuffer = result[key];
                this.logger.log(
                  `Found buffer in property '${key}' for page ${page} (${imageBuffer.length} bytes)`
                );
                break;
              }
            }
          }

          // Check if buffer is empty (indicates GraphicsMagick/ImageMagick not working)
          if (imageBuffer && imageBuffer.length === 0) {
            this.logger.error(
              `pdf2pic returned empty buffer (0 bytes) for page ${page}. ` +
                `This usually means GraphicsMagick or ImageMagick is not installed or not working.`
            );
            if (page === 1) {
              throw new Error(
                "PDF conversion failed: pdf2pic returned empty buffer (0 bytes). " +
                  "This indicates GraphicsMagick or ImageMagick is not installed or not working properly. " +
                  "Please install one of these tools:\n" +
                  "- Windows: Download from https://imagemagick.org/script/download.php or use: choco install imagemagick\n" +
                  "- Linux: sudo apt-get install graphicsmagick or sudo apt-get install imagemagick\n" +
                  "- macOS: brew install graphicsmagick or brew install imagemagick\n\n" +
                  "After installation, make sure the tool is in your system PATH and restart the application."
              );
            }
            // Continue to next page instead of breaking
            failedPages++;
            this.logger.warn(
              `Skipping page ${page} due to empty buffer, continuing with remaining pages...`
            );
            continue;
          }

          // Validate the image buffer before adding
          if (imageBuffer && this.validateImageBuffer(imageBuffer)) {
            images.push(imageBuffer);
            successfulPages++;
            this.logger.log(
              `Successfully converted page ${page}/${totalPagesToProcess} (${imageBuffer.length} bytes)`
            );
          } else {
            const errorDetails = {
              bufferSize: imageBuffer?.length || 0,
              bufferType: imageBuffer?.constructor?.name,
              firstBytes: imageBuffer
                ? imageBuffer
                    .subarray(0, Math.min(8, imageBuffer.length))
                    .toString("hex")
                : "none",
            };
            this.logger.error(
              `Invalid image data returned for page ${page}:`,
              errorDetails
            );
            if (page === 1) {
              throw new Error(
                `PDF conversion returned invalid image data for page ${page}. ` +
                  `Buffer size: ${errorDetails.bufferSize} bytes, ` +
                  `First bytes: ${errorDetails.firstBytes}. ` +
                  `If buffer size is 0, GraphicsMagick/ImageMagick may not be installed.`
              );
            }
            // Continue to next page instead of breaking
            failedPages++;
            this.logger.warn(
              `Skipping page ${page} due to invalid image data, continuing with remaining pages...`
            );
            continue;
          }
        } catch (error: any) {
          this.logger.error(`Error converting page ${page}:`, error.message);
          if (page === 1) {
            // Page 1 failure indicates a fundamental problem - throw immediately
            throw error;
          }
          // For other pages, log the error but continue processing
          failedPages++;
          this.logger.warn(
            `Failed to convert page ${page}/${totalPagesToProcess}: ${error.message}. Continuing with remaining pages...`
          );
          continue;
        }
      }

      // Log summary
      this.logger.log(
        `PDF conversion complete: ${successfulPages} pages converted successfully, ${failedPages} pages failed out of ${totalPagesToProcess} total pages`
      );

      if (images.length === 0) {
        throw new Error("No images were generated from PDF");
      }

      return images;
    } finally {
      // Clean up temp PDF file
      await fs.unlink(tempPdfPath).catch(() => undefined);
    }
  }

  private validateImageBuffer(buffer: Buffer): boolean {
    if (!buffer || buffer.length < 1024) {
      this.logger.warn(
        `Invalid image buffer: size ${buffer?.length || 0} bytes (too small)`
      );
      return false;
    }

    // Check PNG header
    const pngHeader = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    const jpegHeader = Buffer.from([0xff, 0xd8, 0xff]);

    const isPng = buffer.subarray(0, 8).equals(pngHeader);
    const isJpeg = buffer.subarray(0, 3).equals(jpegHeader);

    if (!isPng && !isJpeg) {
      this.logger.warn(
        `Invalid image format: not a valid PNG or JPEG. First bytes: ${buffer.subarray(0, 8).toString("hex")}`
      );
      return false;
    }

    return true;
  }

  private async convertCadToImages(cadBuffer: Buffer): Promise<Buffer[]> {
    // In a real implementation, you'd use a CAD conversion library
    this.logger.log(
      "CAD to image conversion - using placeholder implementation"
    );
    return [PlanAnalysisService.PLACEHOLDER_PNG];
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
