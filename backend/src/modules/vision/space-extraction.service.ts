import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

import { SheetData } from '../ingest/ingest.service';

export type SpaceCategory = 'cafe' | 'sales' | 'boh' | 'restroom' | 'patio' | 'other';

export interface SpaceDefinition {
  sheetIndex: number;
  sheetName?: string;
  sheetRef?: string | null;
  space_id: string;
  name?: string | null;
  raw_label_text?: string | null;
  raw_area_string?: string | null;
  category: SpaceCategory;
  bbox_px: [number, number, number, number];
  approx_area_sqft?: number | null;
  confidence?: number | null;
  notes?: string | null;
  sheetTrustScore?: number;
  sheetTrustIssues?: string[];
}

export interface SheetTrustSummary {
  sheetIndex: number;
  sheetName?: string;
  trustScore: number;
  issues: string[];
}

export interface SpaceExtractionResult {
  spaces: SpaceDefinition[];
  sheets: SheetTrustSummary[];
}

interface ExtractedSpacePayload {
  space_id: string;
  name?: string | null;
  raw_label_text?: string | null;
  raw_area_string?: string | null;
  category: SpaceCategory;
  bbox_px: [number, number, number, number];
  sheet_ref?: string | null;
  confidence?: number | null;
  notes?: string | null;
}

interface ProcessedSpaceEntry {
  entry: ExtractedSpacePayload;
  areaStringTrusted: boolean;
}

interface AreaConsistencyResult {
  invalidate?: boolean;
  total?: number;
  reference?: number;
  diff?: number;
}

const AREA_REFERENCE_KEYWORDS = ['TOTAL', 'LEASABLE', 'OVERALL', 'GROSS', 'TENANT', 'SUITE', 'BUILDING'];

const SPACE_SCHEMA = {
  type: 'object',
  required: ['spaces'],
  additionalProperties: false,
  properties: {
    spaces: {
      type: 'array',
      items: {
        type: 'object',
        required: ['space_id', 'name', 'raw_label_text', 'raw_area_string', 'category', 'bbox_px', 'sheet_ref', 'confidence', 'notes'],
        properties: {
          space_id: { type: 'string' },
          name: { type: ['string', 'null'] },
          raw_label_text: { type: ['string', 'null'] },
          raw_area_string: { type: ['string', 'null'] },
          category: {
            type: 'string',
            enum: ['cafe', 'sales', 'boh', 'restroom', 'patio', 'other'],
          },
          bbox_px: {
            type: 'array',
            minItems: 4,
            maxItems: 4,
            items: { type: 'number' },
          },
          sheet_ref: { type: ['string', 'null'] },
          confidence: { type: ['number', 'null'] },
          notes: { type: ['string', 'null'] },
        },
        additionalProperties: false,
      },
    },
  },
};

@Injectable()
export class SpaceExtractionService {
  private readonly logger = new Logger(SpaceExtractionService.name);
  private readonly openai?: OpenAI;
  private readonly model: string;
  private readonly textBudget: number;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    this.model =
      this.configService.get<string>('OPENAI_SPACE_MODEL') ||
      this.configService.get<string>('OPENAI_TAKEOFF_MODEL') ||
      'gpt-5-mini-2025-08-07';
    this.textBudget = parseInt(
      this.configService.get<string>('SPACE_TEXT_LIMIT') || '6000',
      10,
    );

    if (apiKey) {
      this.openai = new OpenAI({ apiKey });
    } else {
      this.logger.warn('OPENAI_API_KEY not configured - skipping space extraction');
    }
  }

  async extractSpaces(sheets: SheetData[]): Promise<SpaceExtractionResult> {
    if (!this.openai) {
      return { spaces: [], sheets: [] };
    }

    const targetSheets = sheets.filter((sheet) => {
      const category = sheet.classification?.category;
      return (
        (category === 'floor' || category === 'demo_floor' || category === 'fixture') &&
        sheet.content?.rasterData &&
        sheet.content.rasterData.length > 0
      );
    });

    const spaces: SpaceDefinition[] = [];
    const sheetSummaries: SheetTrustSummary[] = [];
    for (const sheet of targetSheets) {
      try {
        const sheetText = this.getSheetText(sheet);
        const sheetTextUpper = sheetText.toUpperCase();
        const normalizedSheetText = this.normalizeForSearch(sheetText);
        const parsed = await this.extractFromSheet(sheet);
        const spaceEntries: ExtractedSpacePayload[] = Array.isArray(parsed?.spaces)
          ? parsed.spaces
          : [];
        let invalidLabelCount = 0;
        let unsupportedNameCount = 0;

        const processedEntries: ProcessedSpaceEntry[] = [];
        for (const entry of spaceEntries) {
          if (!this.isValidRawSpace(entry)) {
            invalidLabelCount++;
            this.logger.debug(
              `Skipping space ${entry.space_id} on sheet ${sheet.index}: raw_label_text missing or inconsistent with name.`
            );
            continue;
          }
          if (sheetTextUpper.trim().length && !this.isSupportedByText(entry, sheetTextUpper)) {
            unsupportedNameCount++;
            this.logger.debug(
              `Skipping space ${entry.space_id} on sheet ${sheet.index}: name "${entry.name}" not located in OCR text.`,
            );
            continue;
          }
          const areaStringTrusted = this.isAreaStringSupported(entry.raw_area_string, normalizedSheetText);
          if (!areaStringTrusted && entry.raw_area_string) {
            this.logger.debug(
              `Ignoring area value "${entry.raw_area_string}" for space ${entry.space_id} on sheet ${sheet.index}: not found in OCR text.`,
            );
          }
          processedEntries.push({ entry, areaStringTrusted });
        }

        const areaCheck = this.evaluateAreaConsistency(processedEntries, sheetText);
        const dropAreas = areaCheck.invalidate ?? false;
        if (dropAreas && typeof areaCheck.reference === 'number' && typeof areaCheck.total === 'number') {
          const diff = typeof areaCheck.diff === 'number' ? areaCheck.diff.toFixed(1) : 'N/A';
          this.logger.warn(
            `Sheet ${sheet.name || sheet.index}: sum of space areas (${areaCheck.total.toFixed(
              1,
            )} sqft) diverges from reference ${areaCheck.reference.toFixed(
              1,
            )} sqft by ${diff} sqft. Dropping computed areas.`,
          );
        }

        const trust = this.calculateTrustScore({
          sheet,
          processedEntries,
          invalidLabelCount,
          unsupportedNameCount,
          areaCheck,
          candidateCount: spaceEntries.length,
        });

        for (const processed of processedEntries) {
          const entry = processed.entry;
          const approxArea = processed.areaStringTrusted ? this.parseArea(entry.raw_area_string) : null;
          spaces.push({
            sheetIndex: sheet.index,
            sheetName: sheet.name,
            sheetRef: entry.sheet_ref ?? sheet.sheetIdGuess ?? sheet.name,
            space_id: entry.space_id,
            name: entry.name ?? null,
            raw_label_text: entry.raw_label_text ?? null,
            raw_area_string: entry.raw_area_string ?? null,
            category: entry.category,
            bbox_px: entry.bbox_px,
            approx_area_sqft: dropAreas ? null : approxArea,
            confidence: entry.confidence ?? null,
            notes: this.combineNotes(
              entry.notes,
              !processed.areaStringTrusted && entry.raw_area_string ? 'area_text_not_found_in_ocr' : null,
              dropAreas ? 'area_total_inconsistent_with_sheet_reference' : null,
            ),
            sheetTrustScore: trust.score,
            sheetTrustIssues: trust.issues,
          });
        }

        sheetSummaries.push({
          sheetIndex: sheet.index,
          sheetName: sheet.name,
          trustScore: trust.score,
          issues: trust.issues,
        });

        if (trust.score < 0.6) {
          this.logger.warn(
            `Sheet ${sheet.name || sheet.index} flagged low trust (${trust.score}): ${trust.issues.join(
              '; ',
            )}`,
          );
        }
      } catch (error: any) {
        this.logger.warn(
          `Space extraction failed for sheet ${sheet.name || sheet.index}: ${error.message}`,
        );
      }
    }

    return { spaces, sheets: sheetSummaries };
  }

  private async extractFromSheet(sheet: SheetData) {
    const rasterBuffer = sheet.content?.rasterData;
    if (!rasterBuffer || !rasterBuffer.length) {
      throw new Error('Missing raster data for space extraction');
    }

    const rawText = this.getSheetText(sheet);
    const textSnippet =
      rawText.length > this.textBudget ? `${rawText.slice(0, this.textBudget)}...` : rawText;

    const instructions =
      `You are extracting logical spaces (rooms or zones) from a plan.\n` +
      `A "space" is a region of the plan with a distinct use (Cafe, Lounge, Back of House, Restroom, Sales Area, Patio, etc.).\n` +
      `If formal room numbers exist, keep them as space ids; otherwise synthesize descriptive ids (e.g., CAFE, RR-1).\n` +
      `Return JSON with a top-level object {"spaces": [...]} where each entry includes: space_id, name, raw_label_text (exact text string from the sheet that identifies the space), raw_area_string (exact substring like "1208 SQFT"), category (cafe/sales/boh/restroom/patio/other), bbox_px [x1,y1,x2,y2], sheet_ref, confidence, and notes (use null when unknown).\n` +
      `Every name MUST be a substring of raw_label_text. If area text is not visible, set raw_area_string to null and do not invent an area.\n` +
      `TEXT_SNIPPET:\n${textSnippet || '(no text extracted)'}`;

    const base64 = rasterBuffer.toString('base64');

    const response = await this.openai!.chat.completions.create({
      model: this.model,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'PlanSpaces',
          schema: SPACE_SCHEMA,
          strict: true,
        },
      },
      messages: [
        {
          role: 'system',
          content:
            'You identify functional spaces on interior plans. Use both text and image cues. Return JSON arrays only.',
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: instructions },
            {
              type: 'image_url',
              image_url: {
                url: `data:image/png;base64,${base64}`,
                detail: 'high',
              },
            },
          ],
        },
      ],
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('Empty space extraction response');
    }

    const parsed = JSON.parse(content);
    return parsed && typeof parsed === 'object' ? parsed : { spaces: [] };
  }

  private isValidRawSpace(entry: ExtractedSpacePayload): boolean {
    if (!entry || typeof entry !== 'object') {
      return false;
    }
    const label = entry.raw_label_text;
    const name = entry.name;
    if (!label || typeof label !== 'string' || !label.trim()) {
      return false;
    }
    if (!name || typeof name !== 'string' || !name.trim()) {
      return false;
    }
    const labelUpper = label.toUpperCase();
    const nameUpper = name.toUpperCase();
    return labelUpper.includes(nameUpper);
  }

  private isSupportedByText(entry: ExtractedSpacePayload, textUpper: string): boolean {
    if (!textUpper) {
      return true;
    }
    const candidate = entry.name;
    if (!candidate || !candidate.trim()) {
      return false;
    }
    return textUpper.includes(candidate.toUpperCase());
  }

  private isAreaStringSupported(rawArea: string | null | undefined, normalizedText: string): boolean {
    if (!rawArea) {
      return true;
    }
    if (!normalizedText) {
      return false;
    }
    const normalizedArea = this.normalizeForSearch(rawArea);
    if (!normalizedArea) {
      return false;
    }
    return normalizedText.includes(normalizedArea);
  }

  private parseArea(raw?: string | null): number | null {
    if (!raw) {
      return null;
    }
    const normalized = raw.replace(/,/g, '');
    const match = normalized.match(/([\d.]+)\s*(sq\s*ft|sf|ft²|square\s*feet|sf\.)/i);
    if (!match) {
      const numeric = normalized.match(/([\d.]+)/);
      if (!numeric) {
        return null;
      }
      const val = parseFloat(numeric[1]);
      return Number.isFinite(val) ? val : null;
    }
    const value = parseFloat(match[1]);
    return Number.isFinite(value) ? value : null;
  }

  private evaluateAreaConsistency(entries: ProcessedSpaceEntry[], sheetText: string): AreaConsistencyResult {
    const trustedAreas = entries
      .filter((item) => item.areaStringTrusted)
      .map((item) => this.parseArea(item.entry.raw_area_string))
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));

    if (!trustedAreas.length) {
      return { invalidate: false };
    }

    const total = trustedAreas.reduce((sum, value) => sum + value, 0);
    const references = this.extractReferenceAreas(sheetText);
    if (!references.length) {
      return { invalidate: false, total };
    }

    let reference = references[0];
    let minDiff = Math.abs(total - reference);

    for (const candidate of references.slice(1)) {
      const diff = Math.abs(total - candidate);
      if (diff < minDiff) {
        minDiff = diff;
        reference = candidate;
      }
    }

    const invalidate = minDiff > reference * 0.3;
    return { invalidate, total, reference, diff: minDiff };
  }

  private extractReferenceAreas(text: string): number[] {
    if (!text) {
      return [];
    }

    const matches = new Set<number>();
    const regex = /(\d[\d,\.]*)\s*(sq\s*ft|square\s*feet|sf|ft²)/gi;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      const start = Math.max(0, match.index - 40);
      const end = Math.min(text.length, match.index + match[0].length + 40);
      const context = text.slice(start, end).toUpperCase();
      if (!AREA_REFERENCE_KEYWORDS.some((keyword) => context.includes(keyword))) {
        continue;
      }
      const value = parseFloat(match[1].replace(/,/g, ''));
      if (Number.isFinite(value)) {
        matches.add(value);
      }
    }

    return Array.from(matches);
  }

  private normalizeForSearch(value: string): string {
    return (value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  private getSheetText(sheet: SheetData): string {
    const textFromContent = this.coerceText(sheet.content?.textData);
    if (textFromContent) {
      return textFromContent;
    }
    if (typeof sheet.text === 'string') {
      return sheet.text;
    }
    return '';
  }

  private coerceText(value: any): string {
    if (!value) {
      return '';
    }
    if (typeof value === 'string') {
      return value;
    }
    if (Buffer.isBuffer(value)) {
      return value.toString('utf8');
    }
    if (Array.isArray(value)) {
      return value.map((v) => this.coerceText(v)).join('\n');
    }
    if (typeof value === 'object') {
      try {
        return JSON.stringify(value);
      } catch {
        return '';
      }
    }
    return String(value);
  }

  private combineNotes(...notes: (string | null | undefined)[]): string | null {
    const filtered = notes.filter((note) => !!note && note.trim().length > 0) as string[];
    if (!filtered.length) {
      return null;
    }
    return filtered.join(' | ');
  }

  private calculateTrustScore(params: {
    sheet: SheetData;
    processedEntries: ProcessedSpaceEntry[];
    invalidLabelCount: number;
    unsupportedNameCount: number;
    areaCheck: AreaConsistencyResult;
    candidateCount: number;
  }): { score: number; issues: string[] } {
    let score = 1.0;
    const issues: string[] = [];
    const penalize = (issue: string, penalty = 0.1) => {
      issues.push(issue);
      score = Math.max(0, Number((score - penalty).toFixed(2)));
    };

    const processedCount = params.processedEntries.length;
    if (!processedCount) {
      penalize('no_spaces_after_validation', 0.5);
    }

    if (params.invalidLabelCount > 0) {
      const penalty = Math.min(0.4, 0.08 * params.invalidLabelCount);
      penalize(`dropped_${params.invalidLabelCount}_spaces_missing_labels`, penalty);
    }

    if (params.unsupportedNameCount > 0) {
      const penalty = Math.min(0.5, 0.1 * params.unsupportedNameCount);
      penalize(`dropped_${params.unsupportedNameCount}_spaces_missing_text`, penalty);
    }

    const untrustedAreas = params.processedEntries.filter(
      (entry) => entry.entry.raw_area_string && !entry.areaStringTrusted,
    ).length;
    if (untrustedAreas > 0) {
      penalize(`area_strings_without_source_text:${untrustedAreas}`, 0.15);
    }

    const { reference, total, invalidate } = params.areaCheck;
    if (reference && total) {
      const ratio = reference > 0 ? total / reference : undefined;
      if (ratio !== undefined && ratio > 2) {
        penalize('space_area_sum_gt_2x_reference', 0.3);
      } else if (invalidate) {
        penalize('space_area_sum_mismatch_reference', 0.2);
      }
    } else if (invalidate) {
      penalize('space_area_sum_unstable', 0.15);
    }

    if (reference && reference <= 1500 && processedCount > 10) {
      penalize('space_density_too_high_for_small_plan', 0.2);
    } else if (processedCount > 25) {
      penalize('space_count_exceeds_25', 0.2);
    }

    const candidateCount = params.candidateCount || processedCount;
    if (candidateCount > 0) {
      const retention = processedCount / candidateCount;
      if (retention < 0.5) {
        penalize('less_than_half_spaces_survived_validation', 0.2);
      }
    }

    return { score: Number(score.toFixed(2)), issues };
  }
}
