import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import Ajv, { ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';

import { TAKEOFF_JSON_SCHEMA } from './takeoff.schema';

const SYSTEM_PROMPT = `You are an expert construction takeoff analyst. Use ONLY the artifacts provided (text extracted from PDFs and low-res page images). Your response MUST populate every section of the schema (project, sheets, levels, rooms, walls, electrical, meta) using observed data; when something is missing, return nulls and add notes/confidence rather than inventing data.

Hard rules:
- Read dimension strings exactly as printed (e.g., 26'-6"). Do not estimate.
- Calibrate scale per sheet: prefer dimension-string calibration; if unavailable, use title-block scale; otherwise return null and mark "fallback".
- Reconcile room area: prefer printed “#### SQ. FT.”; if absent, compute length × width; if both exist and differ >10%, keep printed and lower confidence.
- Vertical quantities: if RCP shows heights (e.g., 10'-0" Sales, 8'-0" BOH), use them; otherwise use provided defaults and set heightSource="assumption".
- Electrical: when no routing is shown, compute heuristic runs: group fixtures by type, Manhattan distance to panel centroid × slack (1.2), plus two risers (2× ceiling height). Choose simple wire/conduit (e.g., #12 CU, 1/2" EMT) by count; mark confidence 0.6 and add note.
- No prose. Return ONLY JSON that validates against the provided JSON Schema.
- If a required numeric value is unknown, set a reasonable default only where specified; otherwise use null and lower confidence, never fabricate.`;

const DEFAULTS = {
  wallHeightSales: 10,
  wallHeightBOH: 8,
  routingSlack: 1.2,
  maxPerCircuit: { FD2: 10, LT1: 8, J1: 10 },
};

const SETTINGS_FOOTER = `
SETTINGS:
defaults: ${JSON.stringify(DEFAULTS)}
room_aliases: {"SALES AREA":"Sales Area","BACK OF HOUSE":"Back of House","TOILET ROOM":"Toilet Room","ELECTRICAL/IT CLOSET":"Electrical/IT Closet"}
wire_conduit_rules: {"defaultWire":"#12 CU","conduitByCount":{"1-3":"1/2\\" EMT","4-6":"3/4\\" EMT","7-9":"1\\" EMT"}}
`;

const DATA_MODEL_GUIDE = `
DATA MODEL EXPECTATIONS:
- project: name/number/address plus total project area when available. Notes should cite sheet references for totals.
- sheets: every analyzed sheet with id/name/number plus detected scale and pixelsPerFoot.
- levels: building levels/elevations plus any ceiling heights per room. Tag the source (RCP, schedule, assumption).
- rooms: include room number/name, level, sheet_refs, approximate area, finish schedule (floor/walls/ceiling/base), and bounding_box_px + centroid_px in image pixels.
- walls: include ID, partition_type, new_or_existing, adjacent rooms, length/height, and polyline_px coordinates from the plan image.
- electrical: keep panel location (if shown) and circuit heuristic outputs following the rules above.
- meta: report units, schema version, and generatedAt (ISO timestamp).`;

interface AggregatorInput {
  jobId: string;
  pages: any[];
  summary?: any;
  features: any[];
  fusion?: any;
}

@Injectable()
export class TakeoffAggregatorService {
  private readonly logger = new Logger(TakeoffAggregatorService.name);
  private readonly openai: OpenAI;
  private readonly validator: ValidateFunction;
  private readonly ajv: Ajv;
  private readonly model: string;

  constructor(configService: ConfigService) {
    const apiKey = configService.get<string>('OPENAI_API_KEY');
    this.openai = new OpenAI({ apiKey });
    this.model = configService.get<string>('OPENAI_TAKEOFF_MODEL') || 'gpt-4o-mini';

    this.ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(this.ajv);
    this.validator = this.ajv.compile(TAKEOFF_JSON_SCHEMA);
  }

  async aggregate(input: AggregatorInput): Promise<any | null> {
    const messages = this.buildMessages(input, false);
    try {
      const result = await this.invokeModel(messages);
      return result;
    } catch (initialError) {
      this.logger.warn(`Initial takeoff aggregation failed: ${initialError.message}`);
      try {
        const retryMessages = this.buildMessages(input, true);
        const retryResult = await this.invokeModel(retryMessages);
        return retryResult;
      } catch (retryError) {
        this.logger.error(`Retry takeoff aggregation failed: ${retryError.message}`);
        return null;
      }
    }
  }

  private buildMessages(input: AggregatorInput, validationRetry: boolean) {
    const sheetBlocks = (input.pages || [])
      .map((page, idx) => this.describeSheet(page, idx))
      .join('\n\n');

    const featureSummary = this.describeFeatureTotals(input.features);
    const summaryBlock = input.summary ? `\nSUMMARY_OVERVIEW:\n${JSON.stringify(input.summary)}` : '';
    const fusionBlock = this.describeFusionData(input.fusion);

    let userContent = `AGGREGATED_SHEET_ARTIFACTS:
${sheetBlocks}

FEATURE_SUMMARY:
${featureSummary}${summaryBlock}${fusionBlock}

${DATA_MODEL_GUIDE}
${SETTINGS_FOOTER}
OUTPUT: Return ONLY the final project JSON. No explanations. No markdown. No keys with undefined. Omit null numeric fields; keep null for scale fields when unknown.`;

    if (validationRetry) {
      userContent += `\nVALIDATION_ERROR: Fix types to satisfy schema. Do not change values, only types/format. OUTPUT JSON ONLY.`;
    }

    return [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userContent },
    ] as OpenAI.Chat.Completions.ChatCompletionMessageParam[];
  }

  private describeSheet(page: any, index: number): string {
    const header = `SHEET ${index + 1}: ${page.fileName || page.name || 'Unnamed'}`;
    const scale =
      page.scale?.detected ||
      page.scale?.value ||
      page.scale ||
      'Unknown';
    const sheetInfo = {
      index: page.pageIndex ?? index,
      scale,
      pixelsPerFoot: page.scale?.ratio || null,
      discipline: page.discipline || null,
      metadata: page.metadata || {},
    };
    const featureCounts = Object.keys(page.features || {}).reduce((acc, key) => {
      const items = page.features[key];
      if (Array.isArray(items) && items.length > 0) {
        acc[key] = items.length;
      }
      return acc;
    }, {} as Record<string, number>);

    return `${header}
INFO: ${JSON.stringify(sheetInfo)}
FEATURE_COUNTS: ${JSON.stringify(featureCounts)}`;
  }

  private describeFeatureTotals(features: any[]): string {
    const counts = features.reduce((acc, feature) => {
      const type = feature.type || 'UNKNOWN';
      acc[type] = (acc[type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return JSON.stringify(counts);
  }

  private describeFusionData(fusion: any): string {
    if (!fusion) {
      return '';
    }
    const summaryPayload = {
      rooms: Array.isArray(fusion.rooms) ? fusion.rooms : [],
      walls: Array.isArray(fusion.walls) ? fusion.walls : [],
      meta: fusion.meta || {},
    };
    const json = JSON.stringify(summaryPayload);
    const maxLen = 8000;
    const truncated = json.length > maxLen ? `${json.slice(0, maxLen)}...` : json;
    const label = json.length > maxLen ? 'FUSION_DATA (truncated)' : 'FUSION_DATA';
    return `\n${label}:\n${truncated}`;
  }

  private async invokeModel(messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]) {
    const response = await this.openai.chat.completions.create({
      model: this.model,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'ProjectTakeoff',
          schema: TAKEOFF_JSON_SCHEMA,
          strict: true,
        },
      },
      messages,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('Empty response from OpenAI');
    }

    let parsed: any;
    try {
      parsed = JSON.parse(content);
    } catch (error) {
      throw new Error(`Invalid JSON response: ${error.message}`);
    }

    if (!this.validator(parsed)) {
      const detail = this.validator.errors?.map(err => `${err.instancePath} ${err.message}`).join('; ');
      throw new Error(`Schema validation failed: ${detail}`);
    }

    return parsed;
  }
}
