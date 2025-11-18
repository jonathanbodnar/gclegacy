import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

import { SheetData } from '../ingest/ingest.service';
import { RoomScheduleEntry } from './room-schedule-extraction.service';

export interface RoomSpatialMapping {
  sheetIndex: number;
  sheetName?: string;
  room_number: string;
  room_name: string;
  label_center_px?: [number, number] | null;
  bounding_box_px?: [number, number, number, number] | null;
  confidence?: number | null;
  notes?: string | null;
}

const ROOM_SPATIAL_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    required: ['room_number'],
    properties: {
      room_number: { type: 'string' },
      room_name: { type: ['string', 'null'] },
      label_center_px: {
        type: ['array', 'null'],
        items: { type: 'number' },
        minItems: 2,
        maxItems: 2,
      },
      bounding_box_px: {
        type: ['array', 'null'],
        items: { type: 'number' },
        minItems: 4,
        maxItems: 4,
      },
      confidence: { type: ['number', 'null'] },
      notes: { type: ['string', 'null'] },
    },
    additionalProperties: false,
  },
};

@Injectable()
export class RoomSpatialMappingService {
  private readonly logger = new Logger(RoomSpatialMappingService.name);
  private readonly openai?: OpenAI;
  private readonly model: string;
  private readonly scheduleContextBudget: number;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    this.model =
      this.configService.get<string>('OPENAI_ROOM_SPATIAL_MODEL') ||
      this.configService.get<string>('OPENAI_TAKEOFF_MODEL') ||
      'gpt-5-mini-2025-08-07';
    this.scheduleContextBudget = parseInt(
      this.configService.get<string>('ROOM_SPATIAL_SCHEDULE_LIMIT') || '8000',
      10,
    );

    if (apiKey) {
      this.openai = new OpenAI({ apiKey });
    } else {
      this.logger.warn('OPENAI_API_KEY not configured - skipping room spatial mapping');
    }
  }

  async mapRooms(
    scheduleEntries: RoomScheduleEntry[],
    sheets: SheetData[],
  ): Promise<RoomSpatialMapping[]> {
    if (!this.openai || !scheduleEntries.length) {
      return [];
    }

    const floorPlanSheets = sheets.filter((sheet) => {
      const category = sheet.classification?.category;
      const isPlanCategory =
        category === 'floor' || category === 'demo_floor';
      const isPrimaryPlan = sheet.classification?.isPrimaryPlan;
      return (
        (isPlanCategory || isPrimaryPlan) &&
        sheet.content?.rasterData &&
        sheet.content.rasterData.length > 0
      );
    });

    if (!floorPlanSheets.length) {
      return [];
    }

    const scheduleJson = JSON.stringify(
      scheduleEntries.map((entry) => ({
        room_number: entry.room_number,
        room_name: entry.room_name,
      })),
    );
    const scheduleContext =
      scheduleJson.length > this.scheduleContextBudget
        ? scheduleJson.slice(0, this.scheduleContextBudget) + '...'
        : scheduleJson;

    const results: RoomSpatialMapping[] = [];

    for (const sheet of floorPlanSheets) {
      try {
        const sheetMappings = await this.mapSheet(sheet, scheduleContext);
        for (const mapping of sheetMappings) {
          results.push({
            sheetIndex: sheet.index,
            sheetName: sheet.name,
            ...mapping,
          });
        }
      } catch (error: any) {
        this.logger.warn(
          `Room spatial mapping failed for sheet ${sheet.name || sheet.index}: ${error.message}`,
        );
      }
    }

    return results;
  }

  private async mapSheet(sheet: SheetData, scheduleContext: string) {
    const rasterBuffer = sheet.content?.rasterData;
    if (!rasterBuffer || !rasterBuffer.length) {
      throw new Error('Floor plan sheet missing raster data');
    }

    const base64Image = rasterBuffer.toString('base64');
    const instructions =
      `You are analyzing an architectural floor plan image.\n` +
      `Use the provided rooms_from_schedule list to locate each room on the plan.\n` +
      `For each room, output room_number, room_name, label_center_px (x,y), ` +
      `bounding_box_px [x1,y1,x2,y2], and optional confidence (0-1).\n` +
      `If a room cannot be located, return nulls for coordinates and add a note.\n` +
      `rooms_from_schedule:\n${scheduleContext}`;

    const response = await this.openai!.chat.completions.create({
      model: this.model,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'RoomSpatialMapping',
          schema: ROOM_SPATIAL_SCHEMA,
          strict: true,
        },
      },
      messages: [
        {
          role: 'system',
          content:
            'You map schedule-defined rooms onto floor plan images. Return JSON only.',
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: instructions },
            {
              type: 'image_url',
              image_url: {
                url: `data:image/png;base64,${base64Image}`,
                detail: 'low',
              },
            },
          ],
        },
      ],
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('Empty response from spatial mapper');
    }

    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : [];
  }
}
