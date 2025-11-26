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
  raw_label_text?: string | null;
  raw_area_string?: string | null;
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
        required: ['space_id', 'name', 'raw_label_text', 'raw_area_string', 'category', 'bbox_px', 'sheet_ref', 'confidence', 'notes'],
    properties: {
      space_id: { type: 'string' },
      name: { type: ['string', 'null'] },
          raw_label_text: { type: ['string', 'null'] },
          raw_area_string: { type: ['string', 'null'] },
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
      'gpt-5.1-2025-11-13';
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
      const hasValidCategory = category === 'floor' || category === 'demo_floor' || category === 'fixture';
      
      // Accept sheets with either rasterData OR textData (fallback to text-only analysis)
      const hasRasterData = sheet.content?.rasterData && sheet.content.rasterData.length > 0;
      const hasTextData = sheet.content?.textData && sheet.content.textData.length > 100; // At least 100 chars
      
      return hasValidCategory && (hasRasterData || hasTextData);
    });

    const spaces: SpaceDefinition[] = [];
    for (const sheet of targetSheets) {
      try {
        const parsed = await this.extractFromSheet(sheet);
        const spaceEntries = Array.isArray(parsed?.spaces) ? parsed.spaces : [];
        for (const entry of spaceEntries) {
          const approxArea = this.parseArea(entry.raw_area_string);
          spaces.push({
            sheetIndex: sheet.index,
            sheetName: sheet.name,
            sheetRef: entry.sheet_ref ?? sheet.sheetIdGuess ?? sheet.name,
            space_id: entry.space_id,
            name: entry.name ?? null,
            raw_label_text: entry.raw_label_text ?? null,
            raw_area_string: entry.raw_area_string ?? null,
            category: entry.category,
            bbox_px: entry.bbox_px,
            approx_area_sqft: approxArea,
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
    const hasRasterData = rasterBuffer && rasterBuffer.length > 0;

    const rawText = sheet.content?.textData || sheet.text || '';
    const textSnippet =
      rawText.length > this.textBudget ? `${rawText.slice(0, this.textBudget)}...` : rawText;

    const instructions =
      `You are extracting logical spaces (rooms or zones) from a ${hasRasterData ? 'plan' : 'text-based plan document'}.
A "space" is a region of the plan with a distinct use (Cafe, Lounge, Back of House, Restroom, Sales Area, Patio, etc.).
If formal room numbers exist, keep them as space ids; otherwise synthesize descriptive ids (e.g., CAFE, RR-1).
Return JSON with a top-level object {"spaces": [...]} where each entry includes: space_id, name, raw_label_text (exact text string from the sheet that identifies the space), raw_area_string (exact substring like "1208 SQFT"), category (cafe/sales/boh/restroom/patio/other), bbox_px [x1,y1,x2,y2], sheet_ref, confidence, and notes (use null when unknown).
Every name MUST be a substring of raw_label_text. If area text is not visible, set raw_area_string to null and do not invent an area.
${!hasRasterData ? '⚠️  IMAGE NOT AVAILABLE - Extract spaces from text only. Use [0,0,0,0] for bbox_px.\n' : ''}
TEXT_SNIPPET:
${textSnippet || '(no text extracted)'}`;

    // Build message content based on available data
    const messageContent: any[] = [{ type: 'text', text: instructions }];
    
    if (hasRasterData) {
      const base64 = rasterBuffer.toString('base64');
      messageContent.push({
        type: 'image_url',
        image_url: {
          url: `data:image/png;base64,${base64}`,
          detail: 'high',
        },
      });
    }

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
            'You identify functional spaces on interior plans. Use both text and image cues when available. Return JSON arrays only.',
        },
        {
          role: 'user',
          content: messageContent,
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

  private parseArea(raw?: string | null): number | null {
    if (!raw) {
      return null;
    }
    const normalized = raw.replace(/,/g, '');
    const match = normalized.match(/([\d.]+)\s*(sq\s*ft|sf|ft²|square\s*feet|sf\.)/i);
    if (!match) {
      const numeric = normalized.match(/([\d.]+)/);
      if (!numeric) {
        return null;
      }
      const val = parseFloat(numeric[1]);
      return Number.isFinite(val) ? val : null;
    }
    const value = parseFloat(match[1]);
    return Number.isFinite(value) ? value : null;
  }
}
