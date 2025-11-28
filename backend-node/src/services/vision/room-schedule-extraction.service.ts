import OpenAI from 'openai';

import { config } from '../../config/env';
import { SheetData, RoomScheduleEntry } from '../../types/vision';
import { logger as appLogger } from '../../utils/logger';

const ROOM_SCHEDULE_SCHEMA = {
  type: 'object',
  required: ['rows'],
  additionalProperties: false,
  properties: {
    rows: {
      type: 'array',
      items: {
        type: 'object',
        required: [
          'room_number',
          'room_name',
          'floor_finish_code',
          'wall_finish_code',
          'ceiling_finish_code',
          'base_code',
          'notes',
        ],
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
    },
  },
};

const ROOM_SCHEDULE_CATEGORIES = new Set(['materials', 'rr_details', 'fixture', 'other']);

const scopedLogger = (scope: string) => ({
  info: (message: string, payload?: unknown) => appLogger.info(`[${scope}] ${message}`, payload),
  warn: (message: string, payload?: unknown) => appLogger.warn(`[${scope}] ${message}`, payload),
  error: (message: string, payload?: unknown) => appLogger.error(`[${scope}] ${message}`, payload),
});

export class RoomScheduleExtractionService {
  private readonly logger = scopedLogger('RoomScheduleExtractionService');
  private readonly openai?: OpenAI;
  private readonly model: string;
  private readonly textBudget: number;

  constructor() {
    this.model = config.openAiRoomScheduleModel || config.openAiModel || 'gpt-4o-mini';
    this.textBudget = config.roomScheduleTextLimit ?? 6000;
    if (config.openAiApiKey) {
      this.openai = new OpenAI({ apiKey: config.openAiApiKey });
    } else {
      this.logger.warn('OPENAI_API_KEY not configured - skipping room schedule extraction');
    }
  }

  async extractRoomSchedules(sheets: SheetData[]): Promise<RoomScheduleEntry[]> {
    if (!this.openai) {
      return [];
    }

    const entries: RoomScheduleEntry[] = [];
    const relevantSheets = sheets.filter(
      (sheet) =>
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
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `Room schedule extraction failed for sheet ${sheet.name || sheet.index}: ${message}`,
        );
      }
    }

    return entries;
  }

  private async extractFromSheet(sheet: SheetData) {
    if (!this.openai) {
      return [];
    }

    const rawText = sheet.content?.textData || sheet.text || '';
    if (!rawText.trim()) {
      return [];
    }

    const textSnippet =
      rawText.length > this.textBudget ? `${rawText.slice(0, this.textBudget)}...` : rawText;

    const instructions =
      `You are converting architectural schedules to structured JSON.\n` +
      `The OCR text below may include ROOM FINISH SCHEDULE tables. Extract each schedule row with fields:\n` +
      `room_number, room_name, floor_finish_code, wall_finish_code, ceiling_finish_code, base_code.\n` +
      `Ignore text outside the schedule. If a field is blank, return null.\n` +
      `Return an object {"rows": [...]} where each row contains those fields plus optional notes.\n` +
      `TEXT_SNIPPET:\n${textSnippet}`;

    const response = await this.openai.chat.completions.create({
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
    const rows = Array.isArray(parsed?.rows) ? parsed.rows : [];
    return rows;
  }
}

