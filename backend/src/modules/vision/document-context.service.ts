import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import OpenAI from "openai";

/**
 * DocumentContextService - Builds global context from construction documents
 * 
 * This service implements Phase 1 of the two-phase extraction approach:
 * 1. First pass: Extract legends, schedules, and reference data from key pages
 * 2. Build a "ground truth" vocabulary that can be passed to per-page extraction
 * 
 * This dramatically improves consistency because:
 * - The model matches against known items instead of inventing them
 * - Room names, material specs, partition types are consistent across pages
 * - Counts are more accurate because we're identifying, not hallucinating
 */

export interface DocumentContext {
  // Extracted from legends and schedules
  partitionTypes: PartitionType[];
  roomSchedule: RoomScheduleEntry[];
  finishSchedule: FinishScheduleEntry[];
  fixtureSchedule: FixtureScheduleEntry[];
  
  // Document-level metadata
  projectInfo: ProjectInfo;
  scales: ScaleInfo[];
  
  // Cross-reference data
  symbolLegend: SymbolEntry[];
  abbreviations: AbbreviationEntry[];
}

export interface PartitionType {
  id: string;           // PT-1, PT-2, EXT-1, etc.
  description: string;  // "5/8" GWB on 3-5/8" Metal Stud"
  thickness?: number;   // inches
  rating?: string;      // "1-HR", "2-HR", etc.
  source: string;       // Which page/sheet this was found on
}

export interface RoomScheduleEntry {
  roomNumber: string;
  roomName: string;
  floorFinish?: string;
  wallFinish?: string;
  ceilingFinish?: string;
  ceilingHeight?: number;
  area?: number;
  source: string;
}

export interface FinishScheduleEntry {
  code: string;         // PT-1, FL-1, etc.
  type: "wall" | "floor" | "ceiling" | "base";
  material: string;
  manufacturer?: string;
  color?: string;
  source: string;
}

export interface FixtureScheduleEntry {
  symbol: string;
  type: string;
  manufacturer?: string;
  model?: string;
  description: string;
  source: string;
}

export interface ProjectInfo {
  projectName?: string;
  projectNumber?: string;
  address?: string;
  architect?: string;
  date?: string;
}

export interface ScaleInfo {
  sheetType: string;    // "floor plans", "details", etc.
  scale: string;        // "1/4" = 1'-0""
  ratio: number;        // 48
}

export interface SymbolEntry {
  symbol: string;
  meaning: string;
  category: string;     // "plumbing", "electrical", "architectural"
}

export interface AbbreviationEntry {
  abbreviation: string;
  meaning: string;
}

@Injectable()
export class DocumentContextService {
  private readonly logger = new Logger(DocumentContextService.name);
  private openai: OpenAI;

  constructor(private configService: ConfigService) {
    const apiKey = this.configService.get("OPENAI_API_KEY");
    this.openai = new OpenAI({ apiKey: apiKey || "dummy-key" });
  }

  /**
   * Build document context from the first few pages (typically legends, schedules, cover)
   * and any pages that contain schedule/legend information
   */
  async buildDocumentContext(
    pageImages: Buffer[],
    progressCallback?: (message: string) => Promise<void>
  ): Promise<DocumentContext> {
    this.logger.log(`Building document context from ${pageImages.length} pages`);
    
    if (progressCallback) {
      await progressCallback("Phase 1: Extracting document context (legends, schedules)...");
    }

    // Strategy: Analyze first 3-5 pages for cover sheet, legends, schedules
    // Plus scan all pages for any that look like schedules
    const contextPages = await this.identifyContextPages(pageImages);
    
    this.logger.log(`Identified ${contextPages.length} context pages to analyze`);

    // Extract context from identified pages
    const contexts = await Promise.all(
      contextPages.map(async (pageIndex) => {
        try {
          return await this.extractPageContext(pageImages[pageIndex], pageIndex);
        } catch (error: any) {
          this.logger.warn(`Failed to extract context from page ${pageIndex}: ${error.message}`);
          return null;
        }
      })
    );

    // Merge all extracted contexts
    const mergedContext = this.mergeContexts(contexts.filter(Boolean));
    
    this.logger.log(
      `Document context built: ${mergedContext.partitionTypes.length} partition types, ` +
      `${mergedContext.roomSchedule.length} rooms, ${mergedContext.fixtureSchedule.length} fixtures`
    );

    return mergedContext;
  }

  /**
   * Identify which pages contain context information (legends, schedules)
   * Returns array of page indices
   */
  private async identifyContextPages(pageImages: Buffer[]): Promise<number[]> {
    // Always include first few pages (cover, general notes, legends)
    const contextPages: number[] = [];
    const maxInitialPages = Math.min(5, pageImages.length);
    
    for (let i = 0; i < maxInitialPages; i++) {
      contextPages.push(i);
    }

    // For larger documents, sample later pages to find schedules
    // (room schedules often appear later in the set)
    if (pageImages.length > 10) {
      // Check pages that might be finish schedules, door schedules, etc.
      const schedulePageCandidates = [
        Math.floor(pageImages.length * 0.2),
        Math.floor(pageImages.length * 0.4),
        Math.floor(pageImages.length * 0.6),
      ].filter(idx => idx >= maxInitialPages && idx < pageImages.length);
      
      contextPages.push(...schedulePageCandidates);
    }

    return [...new Set(contextPages)]; // Deduplicate
  }

  /**
   * Extract context information from a single page
   */
  private async extractPageContext(
    imageBuffer: Buffer,
    pageIndex: number
  ): Promise<Partial<DocumentContext>> {
    const base64Image = imageBuffer.toString("base64");
    const imageFormat = this.detectImageFormat(imageBuffer);
    const imageUrl = `data:image/${imageFormat};base64,${base64Image}`;

    const prompt = `Analyze this construction document page and extract reference information.

Look for and extract:

1. PARTITION TYPE LEGEND/SCHEDULE - Wall type codes like PT-1, PT-2, EXT-1 with their descriptions
2. ROOM SCHEDULE/FINISH SCHEDULE - Room numbers, names, and finishes
3. SYMBOL LEGEND - Symbols and their meanings (plumbing fixtures, electrical symbols, etc.)
4. ABBREVIATION LIST - Common abbreviations used in the drawings
5. PROJECT INFO - Project name, number, address from title block
6. SCALE INFORMATION - Drawing scales noted on the page

Return ONLY a JSON object with this structure (use empty arrays for sections not found):

{
  "partitionTypes": [
    {"id": "PT-1", "description": "5/8\" GWB on 3-5/8\" Metal Stud", "thickness": 4.25, "rating": "1-HR"}
  ],
  "roomSchedule": [
    {"roomNumber": "101", "roomName": "OFFICE", "floorFinish": "CPT-1", "wallFinish": "PT-1", "ceilingHeight": 9}
  ],
  "finishSchedule": [
    {"code": "PT-1", "type": "wall", "material": "Painted Gypsum Board"}
  ],
  "fixtureSchedule": [
    {"symbol": "WC", "type": "Water Closet", "description": "Floor-mounted toilet"}
  ],
  "symbolLegend": [
    {"symbol": "circle with X", "meaning": "Floor drain", "category": "plumbing"}
  ],
  "abbreviations": [
    {"abbreviation": "GWB", "meaning": "Gypsum Wall Board"}
  ],
  "projectInfo": {
    "projectName": "Example Building",
    "projectNumber": "2024-001"
  },
  "scales": [
    {"sheetType": "floor plans", "scale": "1/4\" = 1'-0\"", "ratio": 48}
  ]
}

IMPORTANT:
- Only extract information that is EXPLICITLY shown on this page
- Do NOT guess or infer values
- Use empty arrays [] for categories not found on this page
- Read exact text from legends and schedules`;

    try {
      const response = await this.openai.chat.completions.create({
        model: "gpt-4o", // Using correct model name
        messages: [
          {
            role: "system",
            content: "You are an expert at reading construction document legends and schedules. Extract reference information accurately. Return valid JSON only."
          },
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: imageUrl, detail: "high" } }
            ]
          }
        ],
        max_tokens: 4000,
        temperature: 0.1, // Low temperature for more consistent extraction
      });

      const content = response.choices[0]?.message?.content;
      if (!content) return {};

      // Parse JSON response
      const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/) || content.match(/\{[\s\S]*\}/);
      const jsonText = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : content;
      
      const parsed = JSON.parse(jsonText);
      
      // Add source to all entries
      const source = `page_${pageIndex + 1}`;
      
      return {
        partitionTypes: (parsed.partitionTypes || []).map((pt: any) => ({ ...pt, source })),
        roomSchedule: (parsed.roomSchedule || []).map((r: any) => ({ ...r, source })),
        finishSchedule: (parsed.finishSchedule || []).map((f: any) => ({ ...f, source })),
        fixtureSchedule: (parsed.fixtureSchedule || []).map((f: any) => ({ ...f, source })),
        symbolLegend: parsed.symbolLegend || [],
        abbreviations: parsed.abbreviations || [],
        projectInfo: parsed.projectInfo || {},
        scales: parsed.scales || [],
      };
    } catch (error: any) {
      this.logger.warn(`Context extraction failed for page ${pageIndex}: ${error.message}`);
      return {};
    }
  }

  /**
   * Merge multiple partial contexts into a single DocumentContext
   */
  private mergeContexts(contexts: Partial<DocumentContext>[]): DocumentContext {
    const merged: DocumentContext = {
      partitionTypes: [],
      roomSchedule: [],
      finishSchedule: [],
      fixtureSchedule: [],
      projectInfo: {},
      scales: [],
      symbolLegend: [],
      abbreviations: [],
    };

    for (const ctx of contexts) {
      if (ctx.partitionTypes) {
        merged.partitionTypes.push(...ctx.partitionTypes);
      }
      if (ctx.roomSchedule) {
        merged.roomSchedule.push(...ctx.roomSchedule);
      }
      if (ctx.finishSchedule) {
        merged.finishSchedule.push(...ctx.finishSchedule);
      }
      if (ctx.fixtureSchedule) {
        merged.fixtureSchedule.push(...ctx.fixtureSchedule);
      }
      if (ctx.symbolLegend) {
        merged.symbolLegend.push(...ctx.symbolLegend);
      }
      if (ctx.abbreviations) {
        merged.abbreviations.push(...ctx.abbreviations);
      }
      if (ctx.scales) {
        merged.scales.push(...ctx.scales);
      }
      if (ctx.projectInfo && Object.keys(ctx.projectInfo).length > 0) {
        merged.projectInfo = { ...merged.projectInfo, ...ctx.projectInfo };
      }
    }

    // Deduplicate by ID/code
    merged.partitionTypes = this.deduplicateById(merged.partitionTypes, 'id');
    merged.roomSchedule = this.deduplicateById(merged.roomSchedule, 'roomNumber');
    merged.finishSchedule = this.deduplicateById(merged.finishSchedule, 'code');
    merged.fixtureSchedule = this.deduplicateById(merged.fixtureSchedule, 'symbol');
    merged.abbreviations = this.deduplicateById(merged.abbreviations, 'abbreviation');

    return merged;
  }

  private deduplicateById<T extends Record<string, any>>(items: T[], idField: string): T[] {
    const seen = new Map<string, T>();
    for (const item of items) {
      const id = item[idField];
      if (id && !seen.has(id)) {
        seen.set(id, item);
      }
    }
    return Array.from(seen.values());
  }

  private detectImageFormat(buffer: Buffer): "png" | "jpeg" {
    if (buffer.length < 3) return "png";
    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    if (buffer.subarray(0, 4).equals(pngHeader)) return "png";
    return "jpeg";
  }

  /**
   * Format document context as a concise string for inclusion in prompts
   */
  formatContextForPrompt(context: DocumentContext): string {
    const parts: string[] = [];

    if (context.partitionTypes.length > 0) {
      parts.push("PARTITION TYPES (use these codes):");
      context.partitionTypes.forEach(pt => {
        parts.push(`  ${pt.id}: ${pt.description}${pt.rating ? ` [${pt.rating}]` : ''}`);
      });
    }

    if (context.roomSchedule.length > 0) {
      parts.push("\nROOM SCHEDULE (known rooms):");
      context.roomSchedule.slice(0, 30).forEach(room => { // Limit to 30 to save tokens
        parts.push(`  ${room.roomNumber}: ${room.roomName}`);
      });
      if (context.roomSchedule.length > 30) {
        parts.push(`  ... and ${context.roomSchedule.length - 30} more rooms`);
      }
    }

    if (context.fixtureSchedule.length > 0) {
      parts.push("\nFIXTURE TYPES (use these codes):");
      context.fixtureSchedule.forEach(f => {
        parts.push(`  ${f.symbol}: ${f.type} - ${f.description}`);
      });
    }

    if (context.scales.length > 0) {
      parts.push("\nDRAWING SCALES:");
      context.scales.forEach(s => {
        parts.push(`  ${s.sheetType}: ${s.scale} (ratio ${s.ratio})`);
      });
    }

    if (context.abbreviations.length > 0) {
      parts.push("\nABBREVIATIONS:");
      context.abbreviations.slice(0, 20).forEach(a => {
        parts.push(`  ${a.abbreviation} = ${a.meaning}`);
      });
    }

    return parts.join('\n');
  }
}
