import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import OpenAI from "openai";

import { SheetData } from "../ingest/ingest.service";
import { PartitionTypeDefinition } from "./partition-type-extraction.service";
import { SpaceDefinition } from "./space-extraction.service";

export interface WallRunSegment {
  sheetIndex: number;
  sheetName?: string;
  id: string;
  partition_type_id?: string | null;
  new_or_existing?: "new" | "existing" | "demo" | null;
  endpoints_px: [number, number][];
  adjacent_rooms?: (string | null)[];
  space_ids?: (string | null)[];
  notes?: string | null;
  confidence?: number | null;
}

const WALL_RUN_SCHEMA = {
  type: "object",
  required: ["segments"],
  additionalProperties: false,
  properties: {
    segments: {
      type: "array",
      items: {
        type: "object",
        required: [
          "id",
          "endpoints_px",
          "partition_type_id",
          "new_or_existing",
          "adjacent_rooms",
          "space_ids",
          "confidence",
          "notes",
        ],
        properties: {
          id: { type: "string" },
          partition_type_id: { type: ["string", "null"] },
          new_or_existing: {
            type: ["string", "null"],
            enum: ["new", "existing", "demo", null],
          },
          endpoints_px: {
            type: "array",
            items: {
              type: "array",
              items: { type: "number" },
              minItems: 2,
              maxItems: 2,
            },
            minItems: 2,
          },
          adjacent_rooms: {
            type: "array",
            items: { type: ["string", "null"] },
            maxItems: 2,
          },
          space_ids: {
            type: "array",
            items: { type: ["string", "null"] },
            maxItems: 2,
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
export class WallRunExtractionService {
  private readonly logger = new Logger(WallRunExtractionService.name);
  private readonly openai?: OpenAI;
  private readonly model: string;
  private readonly partitionContextBudget: number;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>("OPENAI_API_KEY");
    this.model =
      this.configService.get<string>("OPENAI_WALL_MODEL") ||
      this.configService.get<string>("OPENAI_TAKEOFF_MODEL") ||
      "gpt-5.1-2025-11-13";
    this.partitionContextBudget = parseInt(
      this.configService.get<string>("WALL_PARTITION_CONTEXT_LIMIT") || "6000",
      10
    );

    if (apiKey) {
      this.openai = new OpenAI({ apiKey });
    } else {
      this.logger.warn(
        "OPENAI_API_KEY not configured - skipping wall extraction"
      );
    }
  }

  async extractWallRuns(
    sheets: SheetData[],
    partitionTypes: PartitionTypeDefinition[],
    spaces: SpaceDefinition[] = []
  ): Promise<WallRunSegment[]> {
    if (!this.openai) return [];

    const floorPlanSheets = sheets.filter((sheet) => {
      const category = sheet.classification?.category;
      const isPlanCategory = category === "floor" || category === "demo_floor";
      const isPrimaryPlan = sheet.classification?.isPrimaryPlan;
      return (
        (isPlanCategory || isPrimaryPlan) &&
        sheet.content?.rasterData &&
        sheet.content.rasterData.length > 0
      );
    });

    if (!floorPlanSheets.length) {
      return [];
    }

    const partitionContextJson = JSON.stringify(
      partitionTypes.map((p) => ({
        partition_type_id: p.partition_type_id,
        fire_rating: p.fire_rating,
        layer_description: p.layer_description,
      }))
    );
    const partitionContext =
      partitionContextJson.length > this.partitionContextBudget
        ? partitionContextJson.slice(0, this.partitionContextBudget) + "..."
        : partitionContextJson;

    const results: WallRunSegment[] = [];

    for (const sheet of floorPlanSheets) {
      const sheetSpaces = spaces.filter(
        (space) => space.sheetIndex === sheet.index
      );
      try {
        const segments = await this.extractFromSheet(
          sheet,
          partitionContext,
          sheetSpaces
        );
        const entries = Array.isArray(segments?.segments)
          ? segments.segments
          : [];
        for (const segment of entries) {
          results.push({
            sheetIndex: sheet.index,
            sheetName: sheet.name,
            ...segment,
          });
        }
      } catch (error: any) {
        this.logger.warn(
          `Wall run extraction failed for sheet ${sheet.name || sheet.index}: ${error.message}`
        );
      }
    }

    return results;
  }

  private async extractFromSheet(
    sheet: SheetData,
    partitionContext: string,
    sheetSpaces: SpaceDefinition[]
  ) {
    const buffer = sheet.content?.rasterData;
    if (!buffer || !buffer.length) {
      throw new Error("Missing raster data for wall extraction");
    }

    const base64Image = buffer.toString("base64");
    const spacesContextJson = JSON.stringify(
      sheetSpaces.map((space) => ({
        space_id: space.space_id,
        name: space.name,
        category: space.category,
        bbox_px: space.bbox_px,
      }))
    );
    const spacesContext =
      spacesContextJson.length > this.partitionContextBudget
        ? spacesContextJson.slice(0, this.partitionContextBudget) + "..."
        : spacesContextJson;
    const instructions =
      `You are analyzing an architectural floor plan to enumerate wall segments.\n` +
      `Partition type definitions:\n${partitionContext}\n` +
      `Spaces on this sheet:\n${spacesContext || "[]"}\n` +
      `Return JSON with a top-level object {"segments": [...]} where each entry contains id, partition_type_id, new_or_existing, endpoints_px (pixel coordinates), space_ids, adjacent_rooms, confidence, and notes (use nulls when unknown).\n` +
      `Use "existing" if a segment appears existing/dashed. If type or rooms are unclear, return null but keep the segment.`;

    const response = await this.openai!.chat.completions.create({
      model: this.model,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "WallSegments",
          schema: WALL_RUN_SCHEMA,
          strict: true,
        },
      },
      messages: [
        {
          role: "system",
          content:
            "You map wall segments on floor plan images. Return JSON arrays only.",
        },
        {
          role: "user",
          content: [
            { type: "text", text: instructions },
            {
              type: "image_url",
              image_url: {
                url: `data:image/png;base64,${base64Image}`,
                detail: "high",
              },
            },
          ],
        },
      ],
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("Empty wall extraction response");
    }

    const parsed = JSON.parse(content);
    return parsed && typeof parsed === "object" ? parsed : { segments: [] };
  }
}
