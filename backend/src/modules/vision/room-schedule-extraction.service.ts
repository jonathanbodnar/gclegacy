import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

import { SheetData } from '../ingest/ingest.service';

export interface RoomScheduleEntry {
  sheetIndex: number;
  sheetName?: string;
  room_number: string;
  room_name: string;
  floor_finish_code?: string | null;
  wall_finish_code?: string | null;
  ceiling_finish_code?: string | null;
  base_code?: string | null;
  sourceCategory?: string;
  notes?: string | null;
}

const ROOM_SCHEDULE_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    required: ['room_number', 'room_name'],
    properties: {
      room_number: { type: 'string' },
      room_name: { type: 'string' },
      floor_finish_code: { type: ['string', 'null'] },
      wall_finish_code: { type: ['string', 'null'] },
      ceiling_finish_code: { type: ['string', 'null'] },
      base_code: { type: ['string', 'null'] },
      notes: { type: ['string', 'null'] },
    },
    additionalProperties: false,
  },
};

const ROOM_SCHEDULE_CATEGORIES = new Set([
  'materials',
  'rr_details',
  'fixture',
  'other',
]);

@Injectable()
export class RoomScheduleExtractionService {
  private readonly logger = new Logger(RoomScheduleExtractionService.name);
  private readonly openai?: OpenAI;
  private readonly model: string;
  private readonly textBudget: number;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    this.model =
      this.configService.get<string>('OPENAI_ROOM_SCHEDULE_MODEL') ||
      this.configService.get<string>('OPENAI_TAKEOFF_MODEL') ||
      'gpt-5-mini-2025-08-07';
    this.textBudget = parseInt(
      this.configService.get<string>('ROOM_SCHEDULE_TEXT_LIMIT') || '6000',
      10,
    );

    if (apiKey) {
      this.openai = new OpenAI({ apiKey });
    } else {
      this.logger.warn('OPENAI_API_KEY not configured - skipping room schedule extraction');
    }
  }

  async extractRoomSchedules(sheets: SheetData[]): Promise<RoomScheduleEntry[]> {
    if (!this.openai) {
      return [];
    }

    const entries: RoomScheduleEntry[] = [];
    const relevantSheets = sheets.filter((sheet) =>
      sheet.classification &&
      ROOM_SCHEDULE_CATEGORIES.has(sheet.classification.category) &&
      (sheet.content?.textData || sheet.text),
    );

    for (const sheet of relevantSheets) {
      try {
        const sheetEntries = await this.extractFromSheet(sheet);
        for (const entry of sheetEntries) {
          entries.push({
            sheetIndex: sheet.index,
            sheetName: sheet.name,
            sourceCategory: sheet.classification?.category,
            ...entry,
          });
        }
      } catch (error: any) {
        this.logger.warn(
          `Room schedule extraction failed for sheet ${sheet.name || sheet.index}: ${error.message}`,
        );
      }
    }

    return entries;
  }

  private async extractFromSheet(sheet: SheetData) {
    const rawText = sheet.content?.textData || sheet.text || '';
    if (!rawText.trim()) {
      return [];
    }

    const textSnippet =
      rawText.length > this.textBudget
        ? `${rawText.slice(0, this.textBudget)}...`
        : rawText;

    const instructions =
      `You are converting architectural schedules to structured JSON.\n` +
      `The OCR text below may include ROOM FINISH SCHEDULE tables. Extract each schedule row with fields:\n` +
      `room_number, room_name, floor_finish_code, wall_finish_code, ceiling_finish_code, base_code.\n` +
      `Ignore text outside the schedule. If a field is blank, return null.\n` +
      `TEXT_SNIPPET:\n${textSnippet}`;

    const response = await this.openai!.chat.completions.create({
      model: this.model,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'RoomFinishSchedule',
          schema: ROOM_SCHEDULE_SCHEMA,
          strict: true,
        },
      },
      messages: [
        {
          role: 'system',
          content:
            'You extract room finish schedules from architectural drawing text. Return only JSON arrays with schedule rows.',
        },
        { role: 'user', content: instructions },
      ],
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('Empty response while extracting schedule');
    }

    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : [];
  }
}
