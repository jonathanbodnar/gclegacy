import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

import { SheetData } from '../ingest/ingest.service';
import { RoomSpatialMapping } from './room-spatial-mapping.service';

export interface RoomCeilingHeight {
  sheetIndex: number;
  sheetName?: string;
  room_number: string;
  height_ft?: number | null;
  source_note?: string | null;
  confidence?: number | null;
  notes?: string | null;
}

const CEILING_HEIGHT_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    required: ['room_number'],
    properties: {
      room_number: { type: 'string' },
      height_ft: { type: ['number', 'null'] },
      source_note: { type: ['string', 'null'] },
      confidence: { type: ['number', 'null'] },
      notes: { type: ['string', 'null'] },
    },
    additionalProperties: false,
  },
};

@Injectable()
export class CeilingHeightExtractionService {
  private readonly logger = new Logger(CeilingHeightExtractionService.name);
  private readonly openai?: OpenAI;
  private readonly model: string;
  private readonly textBudget: number;
  private readonly roomContextBudget: number;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    this.model =
      this.configService.get<string>('OPENAI_CEILING_MODEL') ||
      this.configService.get<string>('OPENAI_TAKEOFF_MODEL') ||
      'gpt-5-mini-2025-08-07';
    this.textBudget = parseInt(
      this.configService.get<string>('CEILING_TEXT_LIMIT') || '6000',
      10,
    );
    this.roomContextBudget = parseInt(
      this.configService.get<string>('CEILING_ROOM_CONTEXT_LIMIT') || '8000',
      10,
    );

    if (apiKey) {
      this.openai = new OpenAI({ apiKey });
    } else {
      this.logger.warn('OPENAI_API_KEY not configured - skipping ceiling extraction');
    }
  }

  async extractHeights(
    sheets: SheetData[],
    roomSpatialMappings: RoomSpatialMapping[],
  ): Promise<RoomCeilingHeight[]> {
    if (!this.openai || !roomSpatialMappings.length) {
      return [];
    }

    const rcSheets = sheets.filter(
      (sheet) =>
        sheet.classification?.category === 'reflected_ceiling' &&
        sheet.content?.rasterData &&
        sheet.content.rasterData.length > 0,
    );

    if (!rcSheets.length) {
      return [];
    }

    const roomContextJson = JSON.stringify(
      roomSpatialMappings.map((mapping) => ({
        room_number: mapping.room_number,
        room_name: mapping.room_name,
        bounding_box_px: mapping.bounding_box_px,
      })),
    );

    const roomContext =
      roomContextJson.length > this.roomContextBudget
        ? roomContextJson.slice(0, this.roomContextBudget) + '...'
        : roomContextJson;

    const results: RoomCeilingHeight[] = [];

    for (const sheet of rcSheets) {
      try {
        const entries = await this.extractFromSheet(sheet, roomContext);
        for (const entry of entries) {
          results.push({
            sheetIndex: sheet.index,
            sheetName: sheet.name,
            ...entry,
          });
        }
      } catch (error: any) {
        this.logger.warn(
          `Ceiling height extraction failed for sheet ${sheet.name || sheet.index}: ${error.message}`,
        );
      }
    }

    return results;
  }

  private async extractFromSheet(sheet: SheetData, roomContext: string) {
    const text = sheet.content?.textData || '';
    const snippet =
      text.length > this.textBudget ? `${text.slice(0, this.textBudget)}...` : text;
    const buffer = sheet.content?.rasterData;
    if (!buffer || !buffer.length) {
      throw new Error('Missing raster data for ceiling plan');
    }

    const base64Image = buffer.toString('base64');
    const instructions =
      `You are extracting ceiling heights by room from a reflected ceiling plan.\n` +
      `Text snippet:\n${snippet}\n` +
      `rooms_from_floor_plan:\n${roomContext}\n` +
      `For each room_number, output height_ft (numeric) if visible, source_note text, confidence (0-1), and notes if ambiguous.\n` +
      `Return JSON array only.`;

    const response = await this.openai!.chat.completions.create({
      model: this.model,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'RoomCeilingHeights',
          schema: CEILING_HEIGHT_SCHEMA,
          strict: true,
        },
      },
      messages: [
        {
          role: 'system',
          content:
            'You map ceiling height notes from reflected ceiling plans to room numbers. Use image + text context to decide.',
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: instructions },
            {
              type: 'image_url',
              image_url: {
                url: `data:image/png;base64,${base64Image}`,
                detail: 'high',
              },
            },
          ],
        },
      ],
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('Empty ceiling extraction response');
    }

    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : [];
  }
}
