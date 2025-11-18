import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

import { SheetData } from '../ingest/ingest.service';

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
  type: 'object',
  required: ['annotations'],
  additionalProperties: false,
  properties: {
    annotations: {
      type: 'array',
      items: {
        type: 'object',
        required: ['sheet_id', 'viewport_label', 'scale_note', 'scale_ratio', 'confidence', 'notes'],
        properties: {
          sheet_id: { type: ['string', 'null'] },
          viewport_label: { type: ['string', 'null'] },
          scale_note: { type: ['string', 'null'] },
          scale_ratio: {
            type: ['object', 'null'],
            properties: {
              plan_units: { type: ['string', 'null'] },
              plan_value: { type: ['number', 'null'] },
              real_units: { type: ['string', 'null'] },
              real_value: { type: ['number', 'null'] },
            },
            required: ['plan_units', 'plan_value', 'real_units', 'real_value'],
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

@Injectable()
export class ScaleExtractionService {
  private readonly logger = new Logger(ScaleExtractionService.name);
  private readonly openai?: OpenAI;
  private readonly model: string;
  private readonly textBudget: number;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    this.model =
      this.configService.get<string>('OPENAI_SCALE_MODEL') ||
      this.configService.get<string>('OPENAI_TAKEOFF_MODEL') ||
      'gpt-5-mini-2025-08-07';
    this.textBudget = parseInt(
      this.configService.get<string>('SCALE_EXTRACTION_TEXT_LIMIT') || '6000',
      10,
    );

    if (apiKey) {
      this.openai = new OpenAI({ apiKey });
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
      const text = sheet.content?.textData || '';
      if (!text.trim()) {
        continue;
      }

      try {
        const sheetAnnotations = await this.extractFromSheet(sheet, text);
        for (const entry of sheetAnnotations) {
          annotations.push({
            sheetIndex: sheet.index,
            sheetName: sheet.name,
            ...entry,
          });
        }
      } catch (error: any) {
        this.logger.warn(
          `Scale extraction failed for sheet ${sheet.name || sheet.index}: ${error.message}`,
        );
      }
    }

    return annotations;
  }

  private async extractFromSheet(sheet: SheetData, text: string): Promise<ScaleAnnotation[]> {
    const snippet =
      text.length > this.textBudget ? `${text.slice(0, this.textBudget)}...` : text;

    const instructions =
      `You extract drawing scales from architectural sheet text. ` +
      `Return JSON with a top-level object {"annotations": [...]} where each entry contains: ` +
      `sheet_id (e.g., ${sheet.sheetIdGuess || 'A-1.1'}), viewport_label/title, scale_note (verbatim text like "1/4\" = 1'-0""), ` +
      `scale_ratio { plan_units (inch/mm/etc), plan_value (numeric), real_units (foot/meter/etc), real_value }, confidence, and notes. ` +
      `Omit entries where the scale cannot be parsed. If multiple scales exist, include each separately. ` +
      `TEXT_SNIPPET:\n${snippet}`;

    const response = await this.openai!.chat.completions.create({
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
          content:
            'You convert architectural sheet text into structured scale annotations. Return JSON arrays only.',
        },
        { role: 'user', content: instructions },
      ],
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('Empty scale extraction response');
    }

    const parsed = JSON.parse(content);
    const annotations = Array.isArray(parsed?.annotations) ? parsed.annotations : [];
    return annotations;
  }
}
