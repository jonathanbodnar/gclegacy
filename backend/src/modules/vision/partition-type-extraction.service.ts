import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

import { SheetData } from '../ingest/ingest.service';

export interface PartitionTypeDefinition {
  sheetIndex: number;
  sheetName?: string;
  partition_type_id: string;
  fire_rating?: string | null;
  layer_description?: string[];
  stud_size?: string | null;
  stud_gauge?: string | null;
  has_acoustical_insulation?: boolean | null;
  notes?: string | null;
}

const PARTITION_TYPE_SCHEMA = {
  type: 'object',
  required: ['partitions'],
  properties: {
    partitions: {
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
    },
  },
  additionalProperties: false,
};

@Injectable()
export class PartitionTypeExtractionService {
  private readonly logger = new Logger(PartitionTypeExtractionService.name);
  private readonly openai?: OpenAI;
  private readonly model: string;
  private readonly textBudget: number;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    this.model =
      this.configService.get<string>('OPENAI_PARTITION_MODEL') ||
      this.configService.get<string>('OPENAI_TAKEOFF_MODEL') ||
      'gpt-4o-mini';
    this.textBudget = parseInt(
      this.configService.get<string>('PARTITION_TEXT_LIMIT') || '6000',
      10,
    );

    if (apiKey) {
      this.openai = new OpenAI({ apiKey });
    } else {
      this.logger.warn('OPENAI_API_KEY not configured - skipping partition extraction');
    }
  }

  async extractPartitionTypes(sheets: SheetData[]): Promise<PartitionTypeDefinition[]> {
    if (!this.openai) return [];

    const definitions: PartitionTypeDefinition[] = [];
    const candidateSheets = sheets.filter((sheet) => {
      const text = (sheet.content?.textData || sheet.text || '').toUpperCase();
      return (
        text.includes('PARTITION') &&
        text.includes('TYPE')
      );
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
      } catch (error: any) {
        this.logger.warn(
          `Partition type extraction failed for sheet ${sheet.name || sheet.index}: ${error.message}`,
        );
      }
    }

    return definitions;
  }

  private async extractFromSheet(sheet: SheetData) {
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

    const response = await this.openai!.chat.completions.create({
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
    return Array.isArray(parsed?.partitions) ? parsed.partitions : [];
  }
}
