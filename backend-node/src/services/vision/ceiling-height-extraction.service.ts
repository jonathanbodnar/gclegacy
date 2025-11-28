import OpenAI from 'openai';

import { config } from '../../config/env';
import {
  RoomCeilingHeight,
  RoomSpatialMapping,
  SheetData,
  SpaceDefinition,
} from '../../types/vision';
import { logger as appLogger } from '../../utils/logger';

const CEILING_HEIGHT_SCHEMA = {
  type: 'object',
  required: ['entries'],
  additionalProperties: false,
  properties: {
    entries: {
      type: 'array',
      items: {
        type: 'object',
        required: [
          'space_id',
          'room_number',
          'height_ft',
          'source_sheet',
          'source_note',
          'confidence',
          'notes',
        ],
        properties: {
          space_id: { type: 'string' },
          room_number: { type: ['string', 'null'] },
          height_ft: { type: ['number', 'null'] },
          source_note: { type: ['string', 'null'] },
          source_sheet: { type: ['string', 'null'] },
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

export class CeilingHeightExtractionService {
  private readonly logger = scopedLogger('CeilingHeightExtractionService');
  private readonly openai?: OpenAI;
  private readonly model: string;
  private readonly textBudget: number;
  private readonly roomContextBudget: number;

  constructor() {
    this.model = config.openAiCeilingModel || config.openAiModel || 'gpt-4o-mini';
    this.textBudget = config.ceilingTextLimit ?? 6000;
    this.roomContextBudget = config.ceilingRoomContextLimit ?? 8000;
    if (config.openAiApiKey) {
      this.openai = new OpenAI({ apiKey: config.openAiApiKey });
    } else {
      this.logger.warn('OPENAI_API_KEY not configured - skipping ceiling extraction');
    }
  }

  async extractHeights(
    sheets: SheetData[],
    roomSpatialMappings: RoomSpatialMapping[],
    spaces: SpaceDefinition[] = [],
  ): Promise<RoomCeilingHeight[]> {
    if (!this.openai) {
      return [];
    }

    const rcSheets = sheets.filter(
      (sheet) =>
        sheet.classification?.category === 'rcp' &&
        sheet.content?.rasterData &&
        sheet.content.rasterData.length > 0,
    );

    if (!rcSheets.length) {
      return [];
    }

    if (!roomSpatialMappings.length && !spaces.length) {
      return [];
    }

    const spatialBySheet = new Map<
      number,
      Array<{ space_id: string; name?: string | null; bbox_px?: [number, number, number, number] | null }>
    >();
    for (const space of spaces) {
      if (!spatialBySheet.has(space.sheetIndex)) {
        spatialBySheet.set(space.sheetIndex, []);
      }
      spatialBySheet.get(space.sheetIndex)!.push({
        space_id: space.space_id,
        name: space.name || space.space_id,
        bbox_px: space.bbox_px,
      });
    }

    const roomMappingBySheet = new Map<
      number,
      Array<{ space_id: string; name?: string | null; bbox_px?: [number, number, number, number] | null }>
    >();
    for (const mapping of roomSpatialMappings) {
      if (!roomMappingBySheet.has(mapping.sheetIndex)) {
        roomMappingBySheet.set(mapping.sheetIndex, []);
      }
      roomMappingBySheet.get(mapping.sheetIndex)!.push({
        space_id: mapping.room_number,
        name: mapping.room_name || mapping.room_number,
        bbox_px: mapping.bounding_box_px || null,
      });
    }

    const results: RoomCeilingHeight[] = [];

    for (const sheet of rcSheets) {
      try {
        const contextEntries =
          spatialBySheet.get(sheet.index) || roomMappingBySheet.get(sheet.index) || [];
        const contextJson = JSON.stringify(contextEntries);
        const trimmedContext =
          contextJson.length > this.roomContextBudget
            ? `${contextJson.slice(0, this.roomContextBudget)}...`
            : contextJson;
        const entries = await this.extractFromSheet(sheet, trimmedContext);
        const heightEntries = Array.isArray(entries?.entries) ? entries.entries : [];
        for (const entry of heightEntries) {
          results.push({
            sheetIndex: sheet.index,
            sheetName: sheet.name,
            room_number: entry.room_number || entry.space_id,
            space_id: entry.space_id,
            height_ft: entry.height_ft,
            source_note: entry.source_note,
            source_sheet: entry.source_sheet ?? sheet.classification?.category ?? null,
            confidence: entry.confidence,
            notes: entry.notes,
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `Ceiling height extraction failed for sheet ${sheet.name || sheet.index}: ${message}`,
        );
      }
    }

    return results;
  }

  private async extractFromSheet(sheet: SheetData, roomContext: string) {
    if (!this.openai) {
      return { entries: [] };
    }

    const text = sheet.content?.textData || sheet.text || '';
    const snippet =
      text.length > this.textBudget ? `${text.slice(0, this.textBudget)}...` : text;
    const buffer = sheet.content?.rasterData;
    if (!buffer || !buffer.length) {
      throw new Error('Missing raster data for ceiling plan');
    }

    const base64Image = buffer.toString('base64');
    const instructions =
      `You are extracting ceiling heights by space from a reflected ceiling plan or elevation.\n` +
      `Text snippet:\n${snippet}\n` +
      `spaces_from_plan:\n${roomContext}\n` +
      `Return JSON with a top-level object {"entries": [...]} where each entry includes space_id, room_number, height_ft (or null), source_sheet label (e.g., RCP, ELEVATIONS), source_note text, confidence (0-1), and notes if ambiguous.\n` +
      `If a height is not present, set height_ft to null and explain in notes.`;

    const response = await this.openai.chat.completions.create({
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
    return parsed && typeof parsed === 'object' ? parsed : { entries: [] };
  }
}

