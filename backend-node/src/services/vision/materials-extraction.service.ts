import OpenAI from 'openai';

import { config } from '../../config/env';
import { SheetData, SpaceDefinition } from '../../types/vision';
import { logger as appLogger } from '../../utils/logger';

export type SpaceFinishCategory = 'cafe' | 'boh' | 'restroom' | 'patio' | 'other';

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
  type: 'object',
  required: ['entries'],
  additionalProperties: false,
  properties: {
    entries: {
      type: 'array',
      items: {
        type: 'object',
        required: ['category', 'floor', 'walls', 'ceiling', 'base', 'notes'],
        properties: {
          category: {
            type: 'string',
            enum: ['cafe', 'boh', 'restroom', 'patio', 'other'],
          },
          floor: { type: ['string', 'null'] },
          walls: {
            type: 'array',
            items: { type: ['string', 'null'] },
          },
          ceiling: { type: ['string', 'null'] },
          base: { type: ['string', 'null'] },
          notes: { type: ['string', 'null'] },
        },
        additionalProperties: false,
      },
    },
  },
};

const scopedLogger = (scope: string) => ({
  info: (message: string, payload?: unknown) => appLogger.info(`[${scope}] ${message}`, payload),
  warn: (message: string, payload?: unknown) => appLogger.warn(`[${scope}] ${message}`, payload),
  error: (message: string, payload?: unknown) => appLogger.error(`[${scope}] ${message}`, payload),
});

export class MaterialsExtractionService {
  private readonly logger = scopedLogger('MaterialsExtractionService');
  private readonly openai?: OpenAI;
  private readonly model: string;
  private readonly textBudget: number;

  constructor() {
    this.model = config.openAiMaterialsModel || config.openAiModel || 'gpt-4o-mini';
    this.textBudget = config.materialsTextLimit ?? 7000;
    if (config.openAiApiKey) {
      this.openai = new OpenAI({ apiKey: config.openAiApiKey });
    } else {
      this.logger.warn('OPENAI_API_KEY not configured - skipping materials extraction');
    }
  }

  async extractFinishes(sheets: SheetData[]): Promise<SpaceFinishDefinition[]> {
    if (!this.openai) {
      return [];
    }

    const finishSheets = sheets.filter((sheet) => {
      const category = sheet.classification?.category;
      return category === 'materials' || category === 'rr_details';
    });

    const results: SpaceFinishDefinition[] = [];
    for (const sheet of finishSheets) {
      const parsed = await this.extractFromSheet(sheet);
        const entries = Array.isArray(parsed?.entries) ? parsed.entries : [];
      for (const finish of entries) {
        results.push({
          sheetIndex: sheet.index,
          sheetName: sheet.name,
          category: finish.category as SpaceFinishCategory,
          floor: finish.floor ?? null,
          walls: Array.isArray(finish.walls) ? finish.walls : undefined,
          ceiling: finish.ceiling ?? null,
          base: finish.base ?? null,
          notes: finish.notes ?? null,
        });
      }
    }

    return results;
  }

  private async extractFromSheet(sheet: SheetData) {
    if (!this.openai) {
      return { entries: [] };
    }

    const rawText = sheet.content?.textData || sheet.text || '';
    const textSnippet =
      rawText.length > this.textBudget ? `${rawText.slice(0, this.textBudget)}...` : rawText;

    const instructions =
      `You are extracting finishes/materials keyed by space type from a materials/finishes sheet.\n` +
      `Space types: "cafe","boh","restroom","patio","other".\n` +
      `For each type, return floor, wall (array), ceiling, base, and optional notes if the sheet specifies them.\n` +
      `Return a top-level object {"entries": [...]} where each entry has category plus those fields (use null if unknown).\n` +
      `TEXT_SNIPPET:\n${textSnippet || '(no text extracted)'}`;

    const response = await this.openai.chat.completions.create({
      model: this.model,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'FinishAssignments',
          schema: FINISH_SCHEMA,
          strict: true,
        },
      },
      messages: [
        {
          role: 'system',
          content: 'You convert materials/finish specifications into structured JSON keyed by space type. Return JSON only.',
        },
        { role: 'user', content: instructions },
      ],
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('Empty materials extraction response');
    }

      const parsed = JSON.parse(content);
      return parsed && typeof parsed === 'object' ? parsed : { entries: [] };
  }
}

