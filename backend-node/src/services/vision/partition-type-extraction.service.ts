import OpenAI from 'openai';

import { config } from '../../config/env';
import { SheetData, PartitionTypeDefinition } from '../../types/vision';
import { logger as appLogger } from '../../utils/logger';

const PARTITION_TYPE_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    required: ['partition_type_id'],
    properties: {
      partition_type_id: { type: 'string' },
      fire_rating: { type: ['string', 'null'] },
      layer_description: {
        type: 'array',
        items: { type: 'string' },
      },
      stud_size: { type: ['string', 'null'] },
      stud_gauge: { type: ['string', 'null'] },
      has_acoustical_insulation: { type: ['boolean', 'null'] },
      notes: { type: ['string', 'null'] },
    },
    additionalProperties: false,
  },
};

const scopedLogger = (scope: string) => ({
  info: (message: string, payload?: unknown) => appLogger.info(`[${scope}] ${message}`, payload),
  warn: (message: string, payload?: unknown) => appLogger.warn(`[${scope}] ${message}`, payload),
  error: (message: string, payload?: unknown) => appLogger.error(`[${scope}] ${message}`, payload),
});

export class PartitionTypeExtractionService {
  private readonly logger = scopedLogger('PartitionTypeExtractionService');
  private readonly openai?: OpenAI;
  private readonly model: string;
  private readonly textBudget: number;

  constructor() {
    this.model = config.openAiPartitionModel || config.openAiModel || 'gpt-4o-mini';
    this.textBudget = config.partitionTextLimit ?? 6000;
    if (config.openAiApiKey) {
      this.openai = new OpenAI({ apiKey: config.openAiApiKey });
    } else {
      this.logger.warn('OPENAI_API_KEY not configured - skipping partition extraction');
    }
  }

  async extractPartitionTypes(sheets: SheetData[]): Promise<PartitionTypeDefinition[]> {
    if (!this.openai) return [];

    const definitions: PartitionTypeDefinition[] = [];
    const candidateSheets = sheets.filter((sheet) => {
      const text = (sheet.content?.textData || sheet.text || '').toUpperCase();
      return text.includes('PARTITION') && text.includes('TYPE');
    });

    for (const sheet of candidateSheets) {
      try {
        const entries = await this.extractFromSheet(sheet);
        for (const entry of entries) {
          definitions.push({
            sheetIndex: sheet.index,
            sheetName: sheet.name,
            ...entry,
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `Partition type extraction failed for sheet ${sheet.name || sheet.index}: ${message}`,
        );
      }
    }

    return definitions;
  }

  private async extractFromSheet(sheet: SheetData) {
    if (!this.openai) {
      return [];
    }

    const text = sheet.content?.textData || sheet.text || '';
    if (!text.trim()) {
      return [];
    }

    const snippet =
      text.length > this.textBudget ? `${text.slice(0, this.textBudget)}...` : text;

    const instructions =
      `You are extracting partition type definitions from architectural notes.\n` +
      `For each partition type table entry, return partition_type_id (numbers like 1/2/3/4), fire_rating, layer_description array, stud_size, stud_gauge, and has_acoustical_insulation.\n` +
      `TEXT_SNIPPET:\n${snippet}`;

    const response = await this.openai.chat.completions.create({
      model: this.model,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'PartitionTypes',
          schema: PARTITION_TYPE_SCHEMA,
          strict: true,
        },
      },
      messages: [
        {
          role: 'system',
          content:
            'You convert architectural partition schedules into structured JSON. Return only JSON arrays.',
        },
        { role: 'user', content: instructions },
      ],
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('Empty partition extraction response');
    }

    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : [];
  }
}

