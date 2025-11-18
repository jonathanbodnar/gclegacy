import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

import { SheetData } from '../ingest/ingest.service';

export type SpaceCategory = 'cafe' | 'sales' | 'boh' | 'restroom' | 'patio' | 'other';

export interface SpaceDefinition {
  sheetIndex: number;
  sheetName?: string;
  sheetRef?: string | null;
  space_id: string;
  name?: string | null;
  category: SpaceCategory;
  bbox_px: [number, number, number, number];
  approx_area_sqft?: number | null;
  confidence?: number | null;
  notes?: string | null;
}

const SPACE_SCHEMA = {
  type: 'object',
  required: ['spaces'],
  additionalProperties: false,
  properties: {
    spaces: {
      type: 'array',
      items: {
        type: 'object',
        required: ['space_id', 'name', 'category', 'bbox_px', 'sheet_ref', 'approx_area_sqft', 'confidence', 'notes'],
        properties: {
          space_id: { type: 'string' },
          name: { type: ['string', 'null'] },
          category: {
            type: 'string',
            enum: ['cafe', 'sales', 'boh', 'restroom', 'patio', 'other'],
          },
          bbox_px: {
            type: 'array',
            minItems: 4,
            maxItems: 4,
            items: { type: 'number' },
          },
          sheet_ref: { type: ['string', 'null'] },
          approx_area_sqft: { type: ['number', 'null'] },
          confidence: { type: ['number', 'null'] },
          notes: { type: ['string', 'null'] },
        },
        additionalProperties: false,
      },
    },
  },
};

@Injectable()
export class SpaceExtractionService {
  private readonly logger = new Logger(SpaceExtractionService.name);
  private readonly openai?: OpenAI;
  private readonly model: string;
  private readonly textBudget: number;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    this.model =
      this.configService.get<string>('OPENAI_SPACE_MODEL') ||
      this.configService.get<string>('OPENAI_TAKEOFF_MODEL') ||
      'gpt-5-mini-2025-08-07';
    this.textBudget = parseInt(
      this.configService.get<string>('SPACE_TEXT_LIMIT') || '6000',
      10,
    );

    if (apiKey) {
      this.openai = new OpenAI({ apiKey });
    } else {
      this.logger.warn('OPENAI_API_KEY not configured - skipping space extraction');
    }
  }

  async extractSpaces(sheets: SheetData[]): Promise<SpaceDefinition[]> {
    if (!this.openai) {
      return [];
    }

    const targetSheets = sheets.filter((sheet) => {
      const category = sheet.classification?.category;
      return (
        (category === 'floor' || category === 'demo_floor' || category === 'fixture') &&
        sheet.content?.rasterData &&
        sheet.content.rasterData.length > 0
      );
    });

    const spaces: SpaceDefinition[] = [];
    for (const sheet of targetSheets) {
      try {
        const parsed = await this.extractFromSheet(sheet);
        const spaceEntries = Array.isArray(parsed?.spaces) ? parsed.spaces : [];
        for (const entry of spaceEntries) {
          spaces.push({
            sheetIndex: sheet.index,
            sheetName: sheet.name,
            sheetRef: entry.sheet_ref ?? sheet.sheetIdGuess ?? sheet.name,
            space_id: entry.space_id,
            name: entry.name ?? null,
            category: entry.category,
            bbox_px: entry.bbox_px,
            approx_area_sqft: entry.approx_area_sqft ?? null,
            confidence: entry.confidence ?? null,
            notes: entry.notes ?? null,
          });
        }
      } catch (error: any) {
        this.logger.warn(
          `Space extraction failed for sheet ${sheet.name || sheet.index}: ${error.message}`,
        );
      }
    }

    return spaces;
  }

  private async extractFromSheet(sheet: SheetData) {
    const rasterBuffer = sheet.content?.rasterData;
    if (!rasterBuffer || !rasterBuffer.length) {
      throw new Error('Missing raster data for space extraction');
    }

    const rawText = sheet.content?.textData || sheet.text || '';
    const textSnippet =
      rawText.length > this.textBudget ? `${rawText.slice(0, this.textBudget)}...` : rawText;

    const instructions =
      `You are extracting logical spaces (rooms or zones) from a plan.\n` +
      `A "space" is a region of the plan with a distinct use (Cafe, Lounge, Back of House, Restroom, Sales Area, Patio, etc.).\n` +
      `If formal room numbers exist, keep them as space ids; otherwise synthesize descriptive ids (e.g., CAFE, RR-1).\n` +
      `Return JSON with a top-level object {"spaces": [...]} where each entry includes: space_id, name, category (cafe/sales/boh/restroom/patio/other), bbox_px [x1,y1,x2,y2], sheet_ref, approx_area_sqft, confidence, notes (use null when unknown).\n` +
      `TEXT_SNIPPET:\n${textSnippet || '(no text extracted)'}`;

    const base64 = rasterBuffer.toString('base64');

    const response = await this.openai!.chat.completions.create({
      model: this.model,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'PlanSpaces',
          schema: SPACE_SCHEMA,
          strict: true,
        },
      },
      messages: [
        {
          role: 'system',
          content:
            'You identify functional spaces on interior plans. Use both text and image cues. Return JSON arrays only.',
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: instructions },
            {
              type: 'image_url',
              image_url: {
                url: `data:image/png;base64,${base64}`,
                detail: 'high',
              },
            },
          ],
        },
      ],
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('Empty space extraction response');
    }

    const parsed = JSON.parse(content);
    return parsed && typeof parsed === 'object' ? parsed : { spaces: [] };
  }
}
