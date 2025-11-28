import OpenAI from 'openai';

import { config } from '../../config/env';
import { RoomScheduleEntry, RoomSpatialMapping, SheetData } from '../../types/vision';
import { logger as appLogger } from '../../utils/logger';

const ROOM_SPATIAL_SCHEMA = {
  type: 'object',
  required: ['mappings'],
  additionalProperties: false,
  properties: {
    mappings: {
      type: 'array',
      items: {
        type: 'object',
        required: [
          'room_number',
          'room_name',
          'label_center_px',
          'bounding_box_px',
          'confidence',
          'notes',
        ],
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
    },
  },
};

const scopedLogger = (scope: string) => ({
  info: (message: string, payload?: unknown) => appLogger.info(`[${scope}] ${message}`, payload),
  warn: (message: string, payload?: unknown) => appLogger.warn(`[${scope}] ${message}`, payload),
  error: (message: string, payload?: unknown) => appLogger.error(`[${scope}] ${message}`, payload),
});

export class RoomSpatialMappingService {
  private readonly logger = scopedLogger('RoomSpatialMappingService');
  private readonly openai?: OpenAI;
  private readonly model: string;
  private readonly scheduleContextBudget: number;

  constructor() {
    this.model = config.openAiRoomSpatialModel || config.openAiModel || 'gpt-4o-mini';
    this.scheduleContextBudget = config.roomSpatialScheduleLimit ?? 8000;
    if (config.openAiApiKey) {
      this.openai = new OpenAI({ apiKey: config.openAiApiKey });
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
      const isPlanCategory = category === 'floor' || category === 'demo_floor';
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
        ? `${scheduleJson.slice(0, this.scheduleContextBudget)}...`
        : scheduleJson;

    const results: RoomSpatialMapping[] = [];

    for (const sheet of floorPlanSheets) {
      try {
        const sheetMappings = await this.mapSheet(sheet, scheduleContext);
        const entries = Array.isArray(sheetMappings?.mappings) ? sheetMappings.mappings : [];
        for (const mapping of entries) {
          results.push({
            sheetIndex: sheet.index,
            sheetName: sheet.name,
            ...mapping,
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `Room spatial mapping failed for sheet ${sheet.name || sheet.index}: ${message}`,
        );
      }
    }

    return results;
  }

  private async mapSheet(sheet: SheetData, scheduleContext: string) {
    if (!this.openai) {
      return { mappings: [] };
    }

    const rasterBuffer = sheet.content?.rasterData;
    if (!rasterBuffer || !rasterBuffer.length) {
      throw new Error('Floor plan sheet missing raster data');
    }

    const base64Image = rasterBuffer.toString('base64');
    const instructions =
      `You are analyzing an architectural floor plan image.\n` +
      `Use the provided rooms_from_schedule list to locate each room on the plan.\n` +
      `Return JSON with a top-level object {"mappings": [...]} where each entry includes room_number, room_name, label_center_px (x,y), bounding_box_px [x1,y1,x2,y2], confidence, and notes (use nulls when unknown).\n` +
      `If a room cannot be located, set both label_center_px and bounding_box_px to null and explain in notes.\n` +
      `rooms_from_schedule:\n${scheduleContext}`;

    const response = await this.openai.chat.completions.create({
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
          content: 'You map schedule-defined rooms onto floor plan images. Return JSON only.',
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
    return parsed && typeof parsed === 'object' ? parsed : { mappings: [] };
  }
}

