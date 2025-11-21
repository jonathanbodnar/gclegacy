import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

import { SheetData, SheetClassificationMetadata } from '../ingest/ingest.service';

const SHEET_CATEGORIES = [
  'site',
  'demo_floor',
  'floor',
  'fixture',
  'rcp',
  'elevations',
  'sections',
  'materials',
  'furniture',
  'artwork',
  'rr_details',
  'other',
] as const;

const SHEET_CLASSIFICATION_SCHEMA = {
  type: 'object',
  required: ['sheet_id', 'title', 'discipline', 'category', 'confidence', 'is_primary_plan', 'notes'],
  properties: {
    sheet_id: { type: ['string', 'null'] },
    title: { type: ['string', 'null'] },
    discipline: {
      type: 'array',
      items: {
        type: 'string',
        enum: ['Architectural', 'Electrical', 'Mechanical', 'Plumbing', 'Fire Protection'],
      },
    },
    category: {
      type: 'string',
      enum: SHEET_CATEGORIES,
    },
    confidence: { type: ['number', 'null'] },
    notes: { type: ['string', 'null'] },
    is_primary_plan: { type: ['boolean', 'null'] },
  },
  additionalProperties: false,
};

@Injectable()
export class SheetClassificationService {
  private readonly logger = new Logger(SheetClassificationService.name);
  private readonly openai?: OpenAI;
  private readonly model: string;
  private readonly textBudget: number;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    this.model =
      this.configService.get<string>('OPENAI_SHEET_CLASSIFIER_MODEL') ||
      this.configService.get<string>('OPENAI_TAKEOFF_MODEL') ||
      'gpt-5-mini-2025-08-07';
    this.textBudget = parseInt(this.configService.get<string>('SHEET_CLASSIFIER_TEXT_LIMIT') || '4000', 10);

    if (apiKey) {
      this.openai = new OpenAI({ apiKey });
    } else {
      this.logger.warn('OPENAI_API_KEY not configured - sheet classification will be skipped');
    }
  }

  async classifySheets(sheets: SheetData[]): Promise<SheetClassificationMetadata[]> {
    if (!this.openai) {
      return sheets.map(() => ({
        discipline: [],
        category: 'other',
        notes: 'OpenAI not configured',
      }));
    }

    const results: SheetClassificationMetadata[] = [];
    for (const sheet of sheets) {
      try {
    const classification = await this.classifySingleSheet(sheet);
        sheet.classification = classification;
        results.push(classification);
      } catch (error: any) {
        this.logger.warn(
          `Sheet classification failed for sheet index ${sheet.index}: ${error.message}`,
        );
        const fallback: SheetClassificationMetadata = {
          sheetId: sheet.sheetIdGuess || sheet.name,
          title: sheet.name,
          discipline: [],
          category: 'other',
          notes: `Classification failed: ${error.message}`,
          isPrimaryPlan: null,
        };
        sheet.classification = fallback;
        results.push(fallback);
      }
    }

    return results;
  }

  private async classifySingleSheet(sheet: SheetData): Promise<SheetClassificationMetadata> {
    const rawText = sheet.content?.textData || sheet.text || '';
    const textSnippet = rawText.slice(0, this.textBudget);
    const trimmedText =
      textSnippet.length === this.textBudget ? `${textSnippet}...` : textSnippet;
    const rasterBuffer: Buffer | undefined = sheet.content?.rasterData;
    const imageParts: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [];

    if (rasterBuffer && rasterBuffer.length > 0) {
      const base64 = rasterBuffer.toString('base64');
      imageParts.push({
        type: 'image_url',
        image_url: {
          url: `data:image/png;base64,${base64}`,
          detail: 'low',
        },
      });
    }

    const instructions =
      `You are classifying architectural and interior design sheets. Analyze the provided low-res page image and OCR text.\n` +
      `Return JSON with: sheet_id, title, discipline array (Architectural/Electrical/Mechanical/Plumbing/Fire Protection), ` +
      `category from ${JSON.stringify(SHEET_CATEGORIES)}, confidence (0-1), notes if uncertain, and is_primary_plan (true if this sheet shows the primary interior plan).\n` +
      `TEXT_SNIPPET (first ${this.textBudget} chars):\n${trimmedText || '(no text extracted)'}`;

    const userContent: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
      { type: 'text', text: instructions },
      ...imageParts,
    ];

    const response = await this.openai.chat.completions.create({
      model: this.model,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'SheetClassification',
          schema: SHEET_CLASSIFICATION_SCHEMA,
          strict: true,
        },
      },
      messages: [
        {
          role: 'system',
          content:
            'You classify architectural PDF sheets. Base decisions strictly on provided text/image. No prose.',
        },
        {
          role: 'user',
          content: userContent,
        },
      ],
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('Empty classification response');
    }

    const parsed = JSON.parse(content);

    return {
      sheetId: parsed.sheet_id ?? sheet.sheetIdGuess ?? sheet.name ?? null,
      title: parsed.title ?? sheet.name ?? null,
      discipline: Array.isArray(parsed.discipline) ? parsed.discipline : [],
      category: parsed.category ?? 'other',
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : null,
      notes: parsed.notes ?? null,
      isPrimaryPlan:
        typeof parsed.is_primary_plan === 'boolean' ? parsed.is_primary_plan : null,
    };
  }
}
