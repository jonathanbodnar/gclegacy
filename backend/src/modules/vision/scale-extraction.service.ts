import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import OpenAI from "openai";

import { SheetData } from "../ingest/ingest.service";

export interface ScaleRatio {
  plan_units?: string | null;
  plan_value?: number | null;
  real_units?: string | null;
  real_value?: number | null;
}

export interface ScaleAnnotation {
  sheetIndex: number;
  sheetName?: string;
  sheet_id?: string | null;
  viewport_label?: string | null;
  scale_note?: string | null;
  scale_ratio?: ScaleRatio | null;
  confidence?: number | null;
  notes?: string | null;
}

const SCALE_EXTRACTION_SCHEMA = {
  type: "object",
  required: ["annotations"],
  additionalProperties: false,
  properties: {
    annotations: {
      type: "array",
      items: {
        type: "object",
        required: [
          "sheet_id",
          "viewport_label",
          "scale_note",
          "scale_ratio",
          "confidence",
          "notes",
        ],
        properties: {
          sheet_id: { type: ["string", "null"] },
          viewport_label: { type: ["string", "null"] },
          scale_note: { type: ["string", "null"] },
          scale_ratio: {
            type: ["object", "null"],
            required: ["plan_units", "plan_value", "real_units", "real_value"],
            properties: {
              plan_units: { type: ["string", "null"] },
              plan_value: { type: ["number", "null"] },
              real_units: { type: ["string", "null"] },
              real_value: { type: ["number", "null"] },
            },
            additionalProperties: false,
          },
          confidence: { type: ["number", "null"] },
          notes: { type: ["string", "null"] },
        },
        additionalProperties: false,
      },
    },
  },
};

@Injectable()
export class ScaleExtractionService {
  private readonly logger = new Logger(ScaleExtractionService.name);
  private readonly openai?: OpenAI;
  private readonly model: string;
  private readonly textBudget: number;
  private readonly parallelLimit: number;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>("OPENAI_API_KEY");
    this.model =
      this.configService.get<string>("OPENAI_SCALE_MODEL") ||
      this.configService.get<string>("OPENAI_TAKEOFF_MODEL") ||
      "gpt-5.1-2025-11-13";
    this.textBudget = parseInt(
      this.configService.get<string>("SCALE_EXTRACTION_TEXT_LIMIT") || "6000",
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
        "OPENAI_API_KEY not configured - skipping scale extraction"
      );
    }
  }

  /**
   * Process items in parallel with controlled concurrency
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

    const workers = Array(Math.min(concurrencyLimit, items.length))
      .fill(null)
      .map(() => worker());

    await Promise.all(workers);
    return results;
  }

  async extractScales(sheets: SheetData[]): Promise<ScaleAnnotation[]> {
    if (!this.openai) {
      return [];
    }

    // Filter sheets with text content
    const validSheets = sheets.filter(sheet => {
      const text = sheet.content?.textData || sheet.text || "";
      return text.trim().length > 0;
    });

    if (!validSheets.length) {
      return [];
    }

    const effectiveLimit = Math.min(this.parallelLimit, validSheets.length);
    this.logger.log(
      `📏 Extracting scales from ${validSheets.length} sheets (parallel: ${effectiveLimit} concurrent)`
    );
    const startTime = Date.now();

    // Process sheets in parallel with controlled concurrency
    const sheetResults = await this.processInParallel(
      validSheets,
      async (sheet, i) => {
        const text = sheet.content?.textData || sheet.text || "";
        try {
          this.logger.log(`  🔍 Scale extraction sheet ${i + 1}/${validSheets.length}: ${sheet.name || sheet.index}`);
          const sheetAnnotations = await this.extractFromSheet(sheet, text);
          return sheetAnnotations.map(entry => ({
            sheetIndex: sheet.index,
            sheetName: sheet.name,
            ...entry,
          }));
        } catch (error: any) {
          this.logger.warn(
            `Scale extraction failed for sheet ${sheet.name || sheet.index}: ${error.message}`
          );
          return [];
        }
      },
      effectiveLimit
    );

    // Flatten results
    const annotations = sheetResults.flat();
    const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
    this.logger.log(`✅ Scale extraction complete: ${annotations.length} annotations from ${validSheets.length} sheets in ${elapsedSec}s`);

    return annotations;
  }

  private async extractFromSheet(
    sheet: SheetData,
    text: string
  ): Promise<ScaleAnnotation[]> {
    const snippet =
      text.length > this.textBudget
        ? `${text.slice(0, this.textBudget)}...`
        : text;

    const instructions =
      `You extract drawing scales from architectural sheet text. ` +
      `Return JSON with a top-level object {"annotations": [...]} where each entry contains: ` +
      `sheet_id (e.g., ${sheet.sheetIdGuess || "A-1.1"}), viewport_label/title, scale_note (verbatim text like "1/4\" = 1'-0"" or "SCALE: 1/8\" = 1'-0""), ` +
      `scale_ratio { plan_units (inch/mm/etc), plan_value (numeric), real_units (foot/meter/etc), real_value }, confidence, and notes. ` +
      `If scale is not explicitly stated, you can ESTIMATE based on typical building dimensions: ` +
      `- Doors are typically 3 feet wide ` +
      `- Wall heights are typically 8-12 feet ` +
      `- Rooms are typically 10-30 feet wide ` +
      `Use confidence="low" for estimates. ALWAYS return at least one scale annotation, even if estimated. ` +
      `Common architectural scales: 1/4"=1'-0" (ratio 48), 1/8"=1'-0" (ratio 96), 1/2"=1'-0" (ratio 24). ` +
      `If multiple scales or viewports exist, include each separately. ` +
      `TEXT_SNIPPET:\n${snippet}`;

    const response = await this.openai!.chat.completions.create({
      model: this.model,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "ScaleAnnotations",
          schema: SCALE_EXTRACTION_SCHEMA,
          strict: true,
        },
      },
      messages: [
        {
          role: "system",
          content:
            "You convert architectural sheet text into structured scale annotations. Return JSON arrays only.",
        },
        { role: "user", content: instructions },
      ],
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("Empty scale extraction response");
    }

    const parsed = JSON.parse(content);
    const annotations = Array.isArray(parsed?.annotations)
      ? parsed.annotations
      : [];
    return annotations;
  }
}
