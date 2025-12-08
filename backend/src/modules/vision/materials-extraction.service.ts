import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import OpenAI from "openai";

import { SheetData } from "../ingest/ingest.service";

export type SpaceFinishCategory =
  | "cafe"
  | "boh"
  | "restroom"
  | "patio"
  | "other";

export interface SpaceFinishDefinition {
  sheetIndex: number;
  sheetName?: string;
  category: SpaceFinishCategory;
  floor?: string | null;
  walls?: (string | null)[];
  ceiling?: string | null;
  base?: string | null;
  notes?: string | null;
}

const FINISH_SCHEMA = {
  type: "object",
  required: ["entries"],
  additionalProperties: false,
  properties: {
    entries: {
      type: "array",
      items: {
        type: "object",
        required: ["category", "floor", "walls", "ceiling", "base", "notes"],
        properties: {
          category: {
            type: "string",
            enum: ["cafe", "boh", "restroom", "patio", "other"],
          },
          floor: { type: ["string", "null"] },
          walls: {
            type: "array",
            items: { type: ["string", "null"] },
          },
          ceiling: { type: ["string", "null"] },
          base: { type: ["string", "null"] },
          notes: { type: ["string", "null"] },
        },
        additionalProperties: false,
      },
    },
  },
};

@Injectable()
export class MaterialsExtractionService {
  private readonly logger = new Logger(MaterialsExtractionService.name);
  private readonly openai?: OpenAI;
  private readonly model: string;
  private readonly textBudget: number;
  private readonly parallelLimit: number;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>("OPENAI_API_KEY");
    this.model =
      this.configService.get<string>("OPENAI_MATERIALS_MODEL") ||
      this.configService.get<string>("OPENAI_TAKEOFF_MODEL") ||
      "gpt-5.1-2025-11-13";
    this.textBudget = parseInt(
      this.configService.get<string>("MATERIALS_TEXT_LIMIT") || "7000",
      10
    );
    this.parallelLimit = parseInt(
      this.configService.get<string>("PARALLEL_EXTRACTION_LIMIT") || "5",
      10
    );

    if (apiKey) {
      this.openai = new OpenAI({ apiKey });
    } else {
      this.logger.warn(
        "OPENAI_API_KEY not configured - skipping materials extraction"
      );
    }
  }

  /**
   * Process items in parallel with controlled concurrency
   * @param cancellationCheck Optional callback to check for job cancellation
   */
  private async processInParallel<T, R>(
    items: T[],
    processor: (item: T, index: number) => Promise<R>,
    concurrencyLimit: number,
    cancellationCheck?: () => void
  ): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let currentIndex = 0;
    let cancelled = false;
    let cancellationError: Error | null = null;

    const worker = async () => {
      while (currentIndex < items.length && !cancelled) {
        try {
          cancellationCheck?.();
        } catch (e) {
          cancelled = true;
          cancellationError = e as Error;
          this.logger.log(`⏹️ Worker detected cancellation - stopping new work`);
          throw e;
        }
        if (cancelled) break;
        const index = currentIndex++;
        if (index >= items.length) break;
        try {
          results[index] = await processor(items[index], index);
          try {
            cancellationCheck?.();
          } catch (e) {
            cancelled = true;
            cancellationError = e as Error;
            throw e;
          }
        } catch (e) {
          if ((e as Error).name === 'JobCancellationError' || 
              (e as Error).message?.includes('cancelled')) {
            cancelled = true;
            cancellationError = e as Error;
            throw e;
          }
          throw e;
        }
      }
    };

    const workers = Array(Math.min(concurrencyLimit, items.length))
      .fill(null)
      .map(() => worker());

    const settledResults = await Promise.allSettled(workers);
    if (cancellationError) {
      this.logger.log(`⏹️ Parallel processing aborted due to cancellation`);
      throw cancellationError;
    }
    const firstRejection = settledResults.find(r => r.status === 'rejected');
    if (firstRejection && firstRejection.status === 'rejected') {
      throw firstRejection.reason;
    }
    return results;
  }

  async extractFinishes(sheets: SheetData[], cancellationCheck?: () => void): Promise<SpaceFinishDefinition[]> {
    if (!this.openai) {
      return [];
    }

    const finishSheets = sheets.filter((sheet) => {
      const category = sheet.classification?.category;
      return category === "materials" || category === "rr_details";
    });

    if (!finishSheets.length) {
      return [];
    }

    const effectiveLimit = Math.min(this.parallelLimit, finishSheets.length);
    this.logger.log(
      `🎨 Extracting materials from ${finishSheets.length} sheets (parallel: ${effectiveLimit} concurrent)`
    );
    const startTime = Date.now();

    // Process sheets in parallel with controlled concurrency
    const sheetResults = await this.processInParallel(
      finishSheets,
      async (sheet, i) => {
        cancellationCheck?.(); // Check before processing each sheet
        try {
          this.logger.log(`  🔍 Materials extraction sheet ${i + 1}/${finishSheets.length}: ${sheet.name || sheet.index}`);
          const parsed = await this.extractFromSheet(sheet);
          const entries = Array.isArray(parsed?.entries) ? parsed.entries : [];
          return entries.map(finish => ({
            sheetIndex: sheet.index,
            sheetName: sheet.name,
            category: finish.category as SpaceFinishCategory,
            floor: finish.floor ?? null,
            walls: Array.isArray(finish.walls) ? finish.walls : undefined,
            ceiling: finish.ceiling ?? null,
            base: finish.base ?? null,
            notes: finish.notes ?? null,
          }));
        } catch (error: any) {
          this.logger.warn(
            `Materials extraction failed for sheet ${sheet.name || sheet.index}: ${error.message}`
          );
          return [];
        }
      },
      effectiveLimit,
      cancellationCheck
    );

    // Flatten results
    const results = sheetResults.flat();
    const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
    this.logger.log(`✅ Materials extraction complete: ${results.length} finishes from ${finishSheets.length} sheets in ${elapsedSec}s`);

    return results;
  }

  private async extractFromSheet(sheet: SheetData) {
    const rawText = sheet.content?.textData || sheet.text || "";
    const textSnippet =
      rawText.length > this.textBudget
        ? `${rawText.slice(0, this.textBudget)}...`
        : rawText;

    const instructions =
      `You are extracting finishes/materials keyed by space type from a materials/finishes sheet.\n` +
      `Space types: "cafe","boh","restroom","patio","other".\n` +
      `For each type, return floor, wall (array), ceiling, base, and optional notes if the sheet specifies them.\n` +
      `Return a top-level object {"entries": [...]} where each entry has category plus those fields (use null if unknown).\n` +
      `TEXT_SNIPPET:\n${textSnippet || "(no text extracted)"}`;

    const response = await this.openai!.chat.completions.create({
      model: this.model,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "FinishAssignments",
          schema: FINISH_SCHEMA,
          strict: true,
        },
      },
      messages: [
        {
          role: "system",
          content:
            "You convert materials/finish specifications into structured JSON keyed by space type. Return JSON only.",
        },
        { role: "user", content: instructions },
      ],
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("Empty materials extraction response");
    }

    const parsed = JSON.parse(content);
    return parsed && typeof parsed === "object" ? parsed : { entries: [] };
  }
}
