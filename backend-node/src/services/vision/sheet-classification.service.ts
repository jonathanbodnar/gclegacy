import OpenAI from 'openai';

import { config } from '../../config/env';
import { SheetData, SheetClassificationMetadata } from '../../types/vision';
import { logger as appLogger } from '../../utils/logger';

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
  required: [
    'sheet_id',
    'title',
    'discipline',
    'category',
    'confidence',
    'is_primary_plan',
    'notes',
  ],
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

const scopedLogger = (scope: string) => ({
  info: (message: string, payload?: unknown) => appLogger.info(`[${scope}] ${message}`, payload),
  warn: (message: string, payload?: unknown) => appLogger.warn(`[${scope}] ${message}`, payload),
  error: (message: string, payload?: unknown) => appLogger.error(`[${scope}] ${message}`, payload),
  debug: (message: string, payload?: unknown) => {
    if ((process.env.NODE_ENV || 'development') !== 'production') {
      appLogger.info(`[${scope}] ${message}`, payload);
    }
  },
});

export class SheetClassificationService {
  private readonly logger = scopedLogger('SheetClassificationService');
  private readonly openai?: OpenAI;
  private readonly model: string;
  private readonly textBudget: number;

  constructor() {
    if (config.openAiApiKey) {
      this.openai = new OpenAI({ apiKey: config.openAiApiKey });
    } else {
      this.logger.warn('OPENAI_API_KEY not configured - sheet classification will be skipped');
    }
    this.model = config.openAiSheetClassifierModel || config.openAiModel || 'gpt-4o-mini';
    this.textBudget = config.sheetClassifierTextLimit ?? 4000;
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
    for (let i = 0; i < sheets.length; i += 1) {
      const sheet = sheets[i];
      try {
        const classification = await this.classifySingleSheet(sheet);
        sheet.classification = classification;
        results.push(classification);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`Sheet classification failed for sheet ${sheet.index}: ${message}`);
        const fallback: SheetClassificationMetadata = {
          sheetId: sheet.sheetIdGuess || sheet.name,
          title: sheet.name,
          discipline: [],
          category: 'other',
          notes: `Classification failed: ${message}`,
          isPrimaryPlan: null,
        };
        sheet.classification = fallback;
        results.push(fallback);
      }
    }

    return results;
  }

  private async classifySingleSheet(sheet: SheetData): Promise<SheetClassificationMetadata> {
    if (!this.openai) {
      return {
        sheetId: sheet.sheetIdGuess ?? sheet.name ?? null,
        title: sheet.name ?? null,
        discipline: [],
        category: 'other',
        confidence: null,
        notes: 'OpenAI not configured',
        isPrimaryPlan: null,
      };
    }

    const rawText = sheet.content?.textData || sheet.text || '';
    const textSnippet =
      rawText.length > this.textBudget ? `${rawText.slice(0, this.textBudget)}...` : rawText;

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
      `TEXT_SNIPPET (first ${this.textBudget} chars):\n${textSnippet || '(no text extracted)'}`;

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
          content: 'You classify architectural PDF sheets. Base decisions strictly on provided text/image. No prose.',
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

