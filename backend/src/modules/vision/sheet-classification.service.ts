import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import OpenAI from "openai";

import {
  SheetData,
  SheetClassificationMetadata,
} from "../ingest/ingest.service";

const SHEET_CATEGORIES = [
  "site",
  "demo_floor",
  "floor",
  "fixture",
  "rcp",
  "elevations",
  "sections",
  "materials",
  "furniture",
  "artwork",
  "rr_details",
  "other",
] as const;

// Categories that need rasterData preserved for downstream extraction
const CATEGORIES_NEEDING_RASTER = [
  "floor",
  "demo_floor",
  "fixture",
  "rcp",
];

// Disciplines that need rasterData preserved for MEP extraction
const DISCIPLINES_NEEDING_RASTER = [
  "Mechanical",
  "Electrical", 
  "Plumbing",
  "Fire Protection",
];

const SHEET_CLASSIFICATION_SCHEMA = {
  type: "object",
  required: [
    "sheet_id",
    "title",
    "discipline",
    "category",
    "confidence",
    "is_primary_plan",
    "notes",
  ],
  properties: {
    sheet_id: { type: ["string", "null"] },
    title: { type: ["string", "null"] },
    discipline: {
      type: "array",
      items: {
        type: "string",
        enum: [
          "Architectural",
          "Electrical",
          "Mechanical",
          "Plumbing",
          "Fire Protection",
        ],
      },
    },
    category: {
      type: "string",
      enum: SHEET_CATEGORIES,
    },
    confidence: { type: ["number", "null"] },
    notes: { type: ["string", "null"] },
    is_primary_plan: { type: ["boolean", "null"] },
  },
  additionalProperties: false,
};

@Injectable()
export class SheetClassificationService {
  private readonly logger = new Logger(SheetClassificationService.name);
  private readonly openai?: OpenAI;
  private readonly model: string;
  private readonly textBudget: number;
  private readonly parallelLimit: number;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>("OPENAI_API_KEY");
    this.model =
      this.configService.get<string>("OPENAI_SHEET_CLASSIFIER_MODEL") ||
      this.configService.get<string>("OPENAI_TAKEOFF_MODEL") ||
      "gpt-5.1-2025-11-13";
    this.textBudget = parseInt(
      this.configService.get<string>("SHEET_CLASSIFIER_TEXT_LIMIT") || "4000",
      10
    );
    // Parallel classification limit - default 5 concurrent requests
    // Set to 1 to disable parallelism, higher values = faster but more API load
    this.parallelLimit = parseInt(
      this.configService.get<string>("PARALLEL_CLASSIFICATION_LIMIT") || "5",
      10
    );

    if (apiKey) {
      this.openai = new OpenAI({ apiKey });
    } else {
      this.logger.warn(
        "OPENAI_API_KEY not configured - sheet classification will be skipped"
      );
    }
  }

  /**
   * Process items in parallel with controlled concurrency
   * @param items Array of items to process
   * @param processor Function to process each item
   * @param concurrencyLimit Max concurrent operations
   */
  private async processInParallel<T, R>(
    items: T[],
    processor: (item: T, index: number) => Promise<R>,
    concurrencyLimit: number
  ): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let currentIndex = 0;

    const worker = async () => {
      while (currentIndex < items.length) {
        const index = currentIndex++;
        results[index] = await processor(items[index], index);
      }
    };

    // Create workers up to the concurrency limit
    const workers = Array(Math.min(concurrencyLimit, items.length))
      .fill(null)
      .map(() => worker());

    await Promise.all(workers);
    return results;
  }

  async classifySheets(
    sheets: SheetData[]
  ): Promise<SheetClassificationMetadata[]> {
    if (!this.openai) {
      this.logger.warn('OpenAI not configured - skipping sheet classification');
      return sheets.map(() => ({
        discipline: [],
        category: "other",
        notes: "OpenAI not configured",
      }));
    }

    const effectiveLimit = Math.min(this.parallelLimit, sheets.length);
    this.logger.log(
      `📄 Classifying ${sheets.length} sheets using model: ${this.model} ` +
      `(parallel: ${effectiveLimit} concurrent requests)`
    );
    
    let completedCount = 0;
    const startTime = Date.now();

    // Process sheets in parallel with controlled concurrency
    const results = await this.processInParallel(
      sheets,
      async (sheet, i) => {
        try {
          this.logger.log(`  🔍 Classifying sheet ${i + 1}/${sheets.length} (index: ${sheet.index}, name: ${sheet.name})`);
          const classification = await this.classifySingleSheet(sheet);
          sheet.classification = classification;
          completedCount++;
          this.logger.log(`  ✅ Sheet ${i + 1} classified as: ${classification.category} (${classification.discipline.join(', ') || 'no discipline'}) [${completedCount}/${sheets.length} done]`);

          // Selectively clear raster buffer - KEEP for sheets that need it for extraction
          const shouldKeepRaster = this.shouldPreserveRasterData(classification);
          if (sheet.content?.rasterData) {
            if (shouldKeepRaster) {
              this.logger.log(`  💾 Sheet ${i + 1}: PRESERVING rasterData for downstream extraction (category: ${classification.category}, disciplines: ${classification.discipline.join(', ')})`);
            } else {
              sheet.content.rasterData = undefined;
              this.logger.debug(`  🗑️ Sheet ${i + 1}: Cleared rasterData (not needed for extraction)`);
            }
          }

          // Force GC periodically if memory is high and GC is available
          if (completedCount % 10 === 0 && global.gc) {
            const memUsage = process.memoryUsage();
            const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
            const heapTotalMB = Math.round(memUsage.heapTotal / 1024 / 1024);

            if (heapUsedMB > heapTotalMB * 0.75) {
              try {
                const before = heapUsedMB;
                global.gc();
                const after = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
                this.logger.debug(`  🧹 GC after ${completedCount} sheets: ${before}MB -> ${after}MB`);
              } catch (e) {
                // Ignore GC errors
              }
            }
          }

          return classification;
        } catch (error: any) {
          this.logger.error(
            `  ❌ Sheet classification failed for sheet ${i + 1}/${sheets.length} (index ${sheet.index}): ${error.message}`,
            error.stack
          );
          const fallback: SheetClassificationMetadata = {
            sheetId: sheet.sheetIdGuess || sheet.name,
            title: sheet.name,
            discipline: [],
            category: "other",
            notes: `Classification failed: ${error.message}`,
            isPrimaryPlan: null,
          };
          sheet.classification = fallback;
          completedCount++;

          // Clear buffer even on error (but check if it should be preserved)
          if (sheet.content?.rasterData) {
            const shouldKeepOnError = sheet.classification && this.shouldPreserveRasterData(sheet.classification);
            if (!shouldKeepOnError) {
              sheet.content.rasterData = undefined;
            }
          }

          return fallback;
        }
      },
      effectiveLimit
    );

    const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
    this.logger.log(`✅ Sheet classification complete: ${results.length} sheets processed in ${elapsedSec}s`);
    return results;
  }

  /**
   * Determine if rasterData should be preserved for downstream extraction
   * Keep rasterData for:
   * - Floor plans, fixture plans, RCP (need images for room/MEP extraction)
   * - Sheets with MEP disciplines (Mechanical, Electrical, Plumbing, Fire Protection)
   */
  private shouldPreserveRasterData(classification: SheetClassificationMetadata): boolean {
    // Check if category needs raster for extraction
    if (CATEGORIES_NEEDING_RASTER.includes(classification.category as any)) {
      return true;
    }
    
    // Check if any discipline needs raster for MEP extraction
    if (classification.discipline && classification.discipline.length > 0) {
      const hasMEPDiscipline = classification.discipline.some(d => 
        DISCIPLINES_NEEDING_RASTER.includes(d)
      );
      if (hasMEPDiscipline) {
        return true;
      }
    }
    
    // Check if it's a primary plan (always keep)
    if (classification.isPrimaryPlan === true) {
      return true;
    }
    
    return false;
  }

  private async classifySingleSheet(
    sheet: SheetData
  ): Promise<SheetClassificationMetadata> {
    const rawText = sheet.content?.textData || sheet.text || "";
    const textSnippet = rawText.slice(0, this.textBudget);
    const trimmedText =
      textSnippet.length === this.textBudget
        ? `${textSnippet}...`
        : textSnippet;
    const rasterBuffer: Buffer | undefined = sheet.content?.rasterData;
    const imageParts: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [];

    // DIAGNOSTIC: Log what data we're receiving for this sheet
    this.logger.log(
      `    📊 Sheet ${sheet.index} data check: ` +
      `rasterData=${rasterBuffer ? `✅ ${Math.round(rasterBuffer.length / 1024)}KB` : '❌ NULL/undefined'}, ` +
      `textData=${rawText.length}chars, ` +
      `imagePath=${sheet.imagePath ? '✅' : '❌'}`
    );

    if (rasterBuffer && rasterBuffer.length > 0) {
      const base64 = rasterBuffer.toString("base64");
      this.logger.log(`    🖼️ Sheet ${sheet.index}: Sending image to OpenAI (base64 length: ${base64.length} chars)`);
      imageParts.push({
        type: "image_url",
        image_url: {
          url: `data:image/png;base64,${base64}`,
          detail: "low",
        },
      });
    } else {
      this.logger.warn(`    ⚠️ Sheet ${sheet.index}: NO IMAGE DATA - OpenAI will only see text!`);
    }

    const instructions =
      `You are classifying architectural and interior design sheets. Analyze the provided low-res page image and OCR text.\n` +
      `Return JSON with: sheet_id, title, discipline array (Architectural/Electrical/Mechanical/Plumbing/Fire Protection), ` +
      `category from ${JSON.stringify(SHEET_CATEGORIES)}, confidence (0-1), notes if uncertain, and is_primary_plan (true if this sheet shows the primary interior plan).\n` +
      `TEXT_SNIPPET (first ${this.textBudget} chars):\n${trimmedText || "(no text extracted)"}`;

    const userContent: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
      { type: "text", text: instructions },
      ...imageParts,
    ];

    this.logger.debug(`    🤖 Calling OpenAI API (model: ${this.model}, has_image: ${imageParts.length > 0})`);
    const startTime = Date.now();

    let response;
    try {
      response = await this.openai.chat.completions.create({
        model: this.model,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "SheetClassification",
            schema: SHEET_CLASSIFICATION_SCHEMA,
            strict: true,
          },
        },
        messages: [
          {
            role: "system",
            content:
              "You classify architectural PDF sheets. Base decisions strictly on provided text/image. No prose.",
          },
          {
            role: "user",
            content: userContent,
          },
        ],
      });

      const duration = Date.now() - startTime;
      this.logger.debug(`    ✅ OpenAI API responded in ${duration}ms`);
    } catch (apiError: any) {
      const duration = Date.now() - startTime;
      this.logger.error(`    ❌ OpenAI API call failed after ${duration}ms: ${apiError.message}`, apiError.stack);
      throw apiError;
    }

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("Empty classification response");
    }

    const parsed = JSON.parse(content);

    return {
      sheetId: parsed.sheet_id ?? sheet.sheetIdGuess ?? sheet.name ?? null,
      title: parsed.title ?? sheet.name ?? null,
      discipline: Array.isArray(parsed.discipline) ? parsed.discipline : [],
      category: parsed.category ?? "other",
      confidence:
        typeof parsed.confidence === "number" ? parsed.confidence : null,
      notes: parsed.notes ?? null,
      isPrimaryPlan:
        typeof parsed.is_primary_plan === "boolean"
          ? parsed.is_primary_plan
          : null,
    };
  }
}
