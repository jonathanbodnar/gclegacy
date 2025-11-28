import OpenAI from 'openai';

import { config } from '../../config/env';
import { SheetData, ScaleAnnotation } from '../../types/vision';
import { logger as appLogger } from '../../utils/logger';

const SCALE_EXTRACTION_SCHEMA = {
  type: 'object',
  required: ['annotations'],
  additionalProperties: false,
  properties: {
    annotations: {
      type: 'array',
      items: {
        type: 'object',
        required: [
          'sheet_id',
          'viewport_label',
          'scale_note',
          'scale_ratio',
          'confidence',
          'notes',
        ],
        properties: {
          sheet_id: { type: ['string', 'null'] },
          viewport_label: { type: ['string', 'null'] },
          scale_note: { type: ['string', 'null'] },
          scale_ratio: {
            type: ['object', 'null'],
            required: ['plan_units', 'plan_value', 'real_units', 'real_value'],
            properties: {
              plan_units: { type: ['string', 'null'] },
              plan_value: { type: ['number', 'null'] },
              real_units: { type: ['string', 'null'] },
              real_value: { type: ['number', 'null'] },
            },
            additionalProperties: false,
          },
          confidence: { type: ['number', 'null'] },
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

export class ScaleExtractionService {
  private readonly logger = scopedLogger('ScaleExtractionService');
  private readonly openai?: OpenAI;
  private readonly model: string;
  private readonly textBudget: number;

  constructor() {
    this.model = config.openAiScaleModel || config.openAiModel || 'gpt-4o-mini';
    this.textBudget = config.scaleExtractionTextLimit ?? 6000;
    if (config.openAiApiKey) {
      this.openai = new OpenAI({ apiKey: config.openAiApiKey });
    } else {
      this.logger.warn('OPENAI_API_KEY not configured - skipping scale extraction');
    }
  }

  async extractScales(sheets: SheetData[]): Promise<ScaleAnnotation[]> {
    if (!this.openai) {
      return [];
    }

    const annotations: ScaleAnnotation[] = [];
    for (const sheet of sheets) {
      const text = sheet.content?.textData || sheet.text || '';
      if (!text.trim()) {
        continue;
      }

      try {
        const sheetAnnotations = await this.extractFromSheet(sheet, text);
        for (const entry of sheetAnnotations) {
          const { sheetIndex: _ignoredIndex, sheetName: _ignoredName, ...rest } = entry;
          annotations.push({
            sheetIndex: sheet.index,
            sheetName: sheet.name,
            ...rest,
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `Scale extraction failed for sheet ${sheet.name || sheet.index}: ${message}`,
        );
      }
    }

    return annotations;
  }

  private async extractFromSheet(sheet: SheetData, text: string): Promise<ScaleAnnotation[]> {
    if (!this.openai) {
      return [];
    }

    const snippet = text.length > this.textBudget ? `${text.slice(0, this.textBudget)}...` : text;

    const instructions =
      `You extract drawing scales from architectural sheet text. ` +
      `Return JSON with a top-level object {"annotations": [...]} where each entry contains: ` +
      `sheet_id (e.g., ${sheet.sheetIdGuess || 'A-1.1'}), viewport_label/title, scale_note (verbatim text like "1/4" = 1'-0" or "SCALE: 1/8" = 1'-0"), ` +
      `scale_ratio { plan_units (inch/mm/etc), plan_value (numeric), real_units (foot/meter/etc), real_value }, confidence, and notes. ` +
      `If scale is not explicitly stated, you can ESTIMATE based on typical building dimensions (doors 3ft wide, wall heights 8-12ft, rooms 10-30ft). ` +
      `Use confidence="low" for estimates. ALWAYS return at least one scale annotation, even if estimated. ` +
      `Common architectural scales: 1/4"=1'-0" (ratio 48), 1/8"=1'-0" (ratio 96), 1/2"=1'-0" (ratio 24). ` +
      `If multiple scales or viewports exist, include each separately.` +
      `TEXT_SNIPPET:\n${snippet}`;

    const response = await this.openai.chat.completions.create({
      model: this.model,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'ScaleAnnotations',
          schema: SCALE_EXTRACTION_SCHEMA,
          strict: true,
        },
      },
      messages: [
        {
          role: 'system',
          content: 'You convert architectural sheet text into structured scale annotations. Return JSON arrays only.',
        },
        { role: 'user', content: instructions },
      ],
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('Empty scale extraction response');
    }

    const parsed = JSON.parse(content);
    return Array.isArray(parsed?.annotations) ? parsed.annotations : [];
  }
}

