import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import OpenAI from "openai";
import { DocumentContext, DocumentContextService } from "./document-context.service";
import { VisionAnalysisResult } from "./openai-vision.service";

/**
 * ContextAwareVisionService - Enhanced multi-pass extraction with sheet-type specific prompts
 * 
 * This service performs:
 * 1. Multi-pass extraction (scale -> rooms -> walls -> MEP) for maximum accuracy
 * 2. Sheet-type specific prompts for better accuracy
 * 3. Sanity checks with warnings
 * 4. Room area recovery
 * 5. Cross-sheet deduplication
 */

export interface ContextAwareAnalysisOptions {
  documentContext?: DocumentContext;
  disciplines: string[];
  targets: string[];
  pageIndex?: number;
  totalPages?: number;
  sheetClassification?: {
    category?: string;
    isPrimaryPlan?: boolean;
    discipline?: string[];
  };
}

// Sheet categories where we should extract specific elements
const ROOM_EXTRACTION_CATEGORIES = ['floor', 'demo_floor'];
const FIXTURE_EXTRACTION_CATEGORIES = ['floor', 'fixture', 'rcp'];
const PIPE_EXTRACTION_CATEGORIES = ['floor', 'fixture'];
const DUCT_EXTRACTION_CATEGORIES = ['floor', 'rcp'];
const WALL_EXTRACTION_CATEGORIES = ['floor', 'demo_floor'];

// Sanity check thresholds for commercial buildings
const SANITY_THRESHOLDS = {
  minWallLengthPerRoom: 40,    // At least 40 LF of walls per room
  minPipeLengthTotal: 50,      // At least 50 LF of piping for commercial
  minDuctLengthTotal: 30,      // At least 30 LF of ductwork
  minFixturesPerRoom: 2,       // At least 2 fixtures per room (lights, outlets)
};

@Injectable()
export class ContextAwareVisionService {
  private readonly logger = new Logger(ContextAwareVisionService.name);
  private openai: OpenAI;

  constructor(
    private configService: ConfigService,
    private documentContextService: DocumentContextService
  ) {
    const apiKey = this.configService.get("OPENAI_API_KEY");
    this.openai = new OpenAI({ apiKey: apiKey || "dummy-key" });
  }

  /**
   * Analyze a plan image with document context for improved accuracy
   * Uses MULTI-PASS extraction for maximum accuracy (separate API calls for each element type)
   */
  async analyzeWithContext(
    imageBuffer: Buffer,
    options: ContextAwareAnalysisOptions
  ): Promise<VisionAnalysisResult> {
    const { documentContext, disciplines, targets, pageIndex = 0, totalPages = 1, sheetClassification } = options;
    
    // Filter targets based on sheet classification
    const filteredTargets = this.filterTargetsBySheetType(targets, sheetClassification);
    
    if (filteredTargets.length === 0) {
      this.logger.log(`Page ${pageIndex}: Skipping extraction - sheet type "${sheetClassification?.category}" doesn't need: ${targets.join(', ')}`);
      return this.getEmptyResult();
    }
    
    if (filteredTargets.length !== targets.length) {
      this.logger.log(`Page ${pageIndex}: Filtered targets from [${targets.join(', ')}] to [${filteredTargets.join(', ')}] for sheet type "${sheetClassification?.category}"`);
    }
    
    const base64Image = imageBuffer.toString("base64");
    const imageFormat = this.detectImageFormat(imageBuffer);
    const imageUrl = `data:image/${imageFormat};base64,${base64Image}`;
    
    const sheetType = sheetClassification?.category || 'floor';
    const sheetDisciplines = sheetClassification?.discipline || [];

    try {
      // MULTI-PASS EXTRACTION for maximum accuracy
      // Each pass focuses on ONE element type for better results
      
      const result = this.getEmptyResult();
      
      // Pass 1: Scale Detection (critical for all measurements)
      this.logger.log(`Page ${pageIndex} [Pass 1/5]: Scale detection`);
      const scaleResult = await this.extractScale(imageUrl, documentContext, pageIndex);
      result.scale = scaleResult.scale;
      result.sheetTitle = scaleResult.sheetTitle;
      
      // Pass 2: Rooms (if targeted)
      if (filteredTargets.includes('rooms')) {
        this.logger.log(`Page ${pageIndex} [Pass 2/5]: Room extraction`);
        const roomsResult = await this.extractRoomsOnly(imageUrl, documentContext, result.scale, pageIndex);
        result.rooms = roomsResult.rooms || [];
        
        // Room area recovery if needed
        if (result.rooms.length > 0) {
          const roomsWithoutAreas = result.rooms.filter(r => !r.area || r.area === 0);
          if (roomsWithoutAreas.length > 0) {
            this.logger.log(`Page ${pageIndex} [Pass 2b]: Room area recovery for ${roomsWithoutAreas.length} rooms`);
            result.rooms = await this.recoverRoomAreas(imageUrl, result.rooms, documentContext);
          }
        }
      }
      
      // Pass 3: Walls (if targeted)
      if (filteredTargets.includes('walls')) {
        this.logger.log(`Page ${pageIndex} [Pass 3/5]: Wall extraction`);
        const wallsResult = await this.extractWallsOnly(imageUrl, documentContext, result.scale, pageIndex);
        result.walls = wallsResult.walls || [];
      }
      
      // Pass 4: Doors & Windows (if targeted)
      if (filteredTargets.includes('doors') || filteredTargets.includes('windows')) {
        this.logger.log(`Page ${pageIndex} [Pass 4/5]: Door/Window extraction`);
        const openingsResult = await this.extractOpeningsOnly(imageUrl, documentContext, result.scale, pageIndex);
        result.openings = openingsResult.openings || [];
      }
      
      // Pass 5: MEP (pipes, ducts, fixtures - if targeted)
      const hasMEP = filteredTargets.includes('pipes') || filteredTargets.includes('ducts') || filteredTargets.includes('fixtures');
      if (hasMEP) {
        this.logger.log(`Page ${pageIndex} [Pass 5/5]: MEP extraction (pipes/ducts/fixtures)`);
        const mepResult = await this.extractMEPOnly(imageUrl, sheetType, sheetDisciplines, documentContext, result.scale, pageIndex);
        result.pipes = mepResult.pipes || [];
        result.ducts = mepResult.ducts || [];
        result.fixtures = mepResult.fixtures || [];
      }
      
      // Run sanity checks and log warnings
      const warnings = this.runSanityChecks(result, sheetType, filteredTargets);
      if (warnings.length > 0) {
        this.logger.warn(`Page ${pageIndex} sanity warnings: ${warnings.join('; ')}`);
      }
      
      // Log extraction results
      this.logger.log(
        `Page ${pageIndex} MULTI-PASS COMPLETE: ${result.rooms?.length || 0} rooms (${this.sumAreas(result.rooms)} SF), ` +
        `${result.walls?.length || 0} walls (${this.sumLengths(result.walls)} LF), ` +
        `${result.pipes?.length || 0} pipes (${this.sumLengths(result.pipes)} LF), ` +
        `${result.ducts?.length || 0} ducts (${this.sumLengths(result.ducts)} LF), ` +
        `${result.fixtures?.length || 0} fixtures`
      );
      
      return result;
    } catch (error: any) {
      this.logger.error(`Context-aware analysis failed for page ${pageIndex}: ${error.message}`);
      return this.getEmptyResult();
    }
  }

  /**
   * Pass 1: Extract scale information only
   */
  private async extractScale(
    imageUrl: string,
    context: DocumentContext | undefined,
    pageIndex: number
  ): Promise<{ scale: VisionAnalysisResult['scale']; sheetTitle?: string }> {
    const prompt = `SCALE EXTRACTION - Focus ONLY on finding the drawing scale.

LOOK FOR:
1. TITLE BLOCK (usually bottom-right corner):
   - "SCALE: 1/4" = 1'-0"" or similar notation
   - "1:100", "1:50", etc. (metric scales)
   - Scale may be listed per view if multiple views

2. GRAPHIC SCALE BAR:
   - A bar with tick marks showing feet/inches

3. REFERENCE DIMENSIONS:
   - Look for dimension strings (like 25'-0", 12'-6")
   - Standard door = 3'-0" wide
   - Standard ceiling grid = 2' x 4' or 2' x 2'

CALCULATE THE RATIO:
- 1/4" = 1'-0" → ratio = 48 (12 inches / 0.25 inches)
- 1/8" = 1'-0" → ratio = 96
- 1/2" = 1'-0" → ratio = 24
- 1" = 1'-0" → ratio = 12
- 1:100 (metric) → ratio = 100

Also extract the SHEET TITLE/NUMBER from the title block (e.g., "A-101", "P-1.0").

RETURN ONLY:
{
  "sheetTitle": "exact sheet number from title block",
  "scale": {
    "detected": "exact scale text as shown (e.g., '1/4\" = 1'-0\"')",
    "ratio": 48,
    "units": "ft",
    "confidence": "high",
    "method": "titleblock"
  }
}`;

    try {
      const response = await this.openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: "You are extracting the scale and sheet title from a construction drawing title block. Return ONLY valid JSON."
          },
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: imageUrl, detail: "high" } }
            ]
          }
        ],
        max_tokens: 1000,
        temperature: 0.0,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        return { scale: this.getDefaultScale() };
      }

      const parsed = JSON.parse(content.match(/\{[\s\S]*\}/)?.[0] || '{}');
      
      return {
        sheetTitle: parsed.sheetTitle,
        scale: this.normalizeScale(parsed.scale)
      };
    } catch (error: any) {
      this.logger.warn(`Scale extraction failed: ${error.message}`);
      return { scale: this.getDefaultScale() };
    }
  }

  /**
   * Pass 2: Extract rooms only (with scale context)
   */
  private async extractRoomsOnly(
    imageUrl: string,
    context: DocumentContext | undefined,
    scale: VisionAnalysisResult['scale'],
    pageIndex: number
  ): Promise<{ rooms: any[] }> {
    const scaleInfo = scale ? `Scale: ${scale.detected} (ratio: ${scale.ratio})` : 'Scale unknown - estimate from standard door width (3 ft)';
    
    const roomScheduleHint = context?.roomSchedule?.length 
      ? `\nROOM SCHEDULE FROM LEGEND:\n${context.roomSchedule.map(r => `- ${r.roomNumber}: ${r.roomName}`).join('\n')}`
      : '';
    
    const prompt = `ROOM EXTRACTION - Focus ONLY on rooms/spaces.

${scaleInfo}
${roomScheduleHint}

SYSTEMATIC EXTRACTION METHOD:
1. Start at top-left corner of the floor plan
2. Identify EVERY enclosed space (rooms, corridors, closets, restrooms)
3. For each room:
   - Read the room NAME from the tag (text inside the room)
   - Read the room NUMBER if shown (often in a circle or near the name)
   - Read the AREA if labeled (look for "XXX SF" or "XXX SQ FT")
   - If no area shown, CALCULATE: length × width from dimension strings

LOOK FOR ROOM TAGS:
- Center of room: "SALES AREA" or "SALES AREA / 1,250 SF"
- Room bubbles with numbers: circled "101", "102"
- Area callouts: "1,250 SF", "950 S.F.", "85 SQ FT"

DIMENSION READING FOR AREA CALCULATION:
- 25'-0" × 50'-0" = 1,250 SF
- 10'-6" × 8'-0" = 84 SF (10.5 × 8)
- Convert inches to decimal: 6" = 0.5 ft, 3" = 0.25 ft

RETURN ONLY:
{
  "rooms": [
    {"id": "101", "name": "SALES AREA", "area": 1250},
    {"id": "102", "name": "BACK OF HOUSE", "area": 450},
    {"id": "103", "name": "TOILET ROOM", "area": 85}
  ]
}

CRITICAL: Extract ALL visible rooms. Commercial spaces typically have 3-20 rooms totaling 1,500-10,000+ SF.`;

    try {
      const response = await this.openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: "You are extracting room information from a floor plan. Read room tags, numbers, and areas carefully. Return ONLY valid JSON."
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
        temperature: 0.0,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) return { rooms: [] };

      const parsed = JSON.parse(content.match(/\{[\s\S]*\}/)?.[0] || '{}');
      return { rooms: Array.isArray(parsed.rooms) ? parsed.rooms : [] };
    } catch (error: any) {
      this.logger.warn(`Room extraction failed: ${error.message}`);
      return { rooms: [] };
    }
  }

  /**
   * Pass 3: Extract walls only (with scale context)
   */
  private async extractWallsOnly(
    imageUrl: string,
    context: DocumentContext | undefined,
    scale: VisionAnalysisResult['scale'],
    pageIndex: number
  ): Promise<{ walls: any[] }> {
    const scaleInfo = scale ? `Scale: ${scale.detected} (ratio: ${scale.ratio})` : 'Scale unknown - estimate from standard door width (3 ft)';
    
    const partitionHint = context?.partitionTypes?.length 
      ? `\nPARTITION TYPES FROM LEGEND:\n${context.partitionTypes.map(p => `- ${p.id}: ${p.description || 'Unknown'}`).join('\n')}`
      : '';
    
    const prompt = `WALL EXTRACTION - Focus ONLY on walls/partitions.

${scaleInfo}
${partitionHint}

SYSTEMATIC EXTRACTION METHOD:
1. Start at the PERIMETER - trace the exterior walls first
2. Move INSIDE - trace interior partitions room by room
3. For EACH wall segment:
   - Identify the PARTITION TYPE from symbols (circles/hexagons on walls with codes like "PT-1", "A", "1")
   - Read the LENGTH from dimension strings (25'-0", 12'-6")
   - If no dimension, MEASURE using scale ratio

PARTITION TYPE IDENTIFICATION:
- Look for circles or hexagons ON the wall lines
- These contain codes: PT-1, PT-2, A, B, 1, 2, 1-HR, 2-HR
- Fire-rated walls marked with hourly ratings (1-HR FIRE WALL)
- Different line weights/patterns indicate different wall types

DIMENSION READING:
- Dimension strings appear along or near walls
- Format: 25'-0", 12'-6", 8'4"
- Convert: 25'-0" = 25.0 LF, 12'-6" = 12.5 LF

GROUPING:
- Sum all segments of the SAME partition type
- Report total linear feet per type

RETURN ONLY:
{
  "walls": [
    {"id": "W1", "partitionType": "PT-1", "length": 145.5},
    {"id": "W2", "partitionType": "PT-2", "length": 87.0},
    {"id": "W3", "partitionType": "1-HR FIRE WALL", "length": 62.5},
    {"id": "W4", "partitionType": "EXTERIOR", "length": 156.0}
  ]
}

CRITICAL: Commercial spaces typically have 200-1000+ LF of walls total.`;

    try {
      const response = await this.openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: "You are extracting wall/partition information from a floor plan. Identify partition types and measure lengths. Return ONLY valid JSON."
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
        temperature: 0.0,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) return { walls: [] };

      const parsed = JSON.parse(content.match(/\{[\s\S]*\}/)?.[0] || '{}');
      return { walls: Array.isArray(parsed.walls) ? parsed.walls : [] };
    } catch (error: any) {
      this.logger.warn(`Wall extraction failed: ${error.message}`);
      return { walls: [] };
    }
  }

  /**
   * Pass 4: Extract doors and windows only
   */
  private async extractOpeningsOnly(
    imageUrl: string,
    context: DocumentContext | undefined,
    scale: VisionAnalysisResult['scale'],
    pageIndex: number
  ): Promise<{ openings: any[] }> {
    const scaleInfo = scale ? `Scale: ${scale.detected} (ratio: ${scale.ratio})` : 'Scale unknown - standard door is 3 ft wide';
    
    const prompt = `DOOR & WINDOW EXTRACTION - Focus ONLY on openings.

${scaleInfo}

DOOR IDENTIFICATION:
- Door SWINGS: Arc lines showing how door opens (90° arc from hinged side)
- Door TAGS: Usually near the door with size (3'-0" x 7'-0") or type number (D1, D2)
- FRAME lines: Parallel lines at wall opening
- Common sizes: 3'-0" (standard), 3'-6" (ADA), 6'-0" (double)

WINDOW IDENTIFICATION:
- Rectangular symbols in exterior walls
- Size callouts: 4'-0" x 5'-0" (width x height)
- Window TAGS: W1, W2 or letter designations
- Glazing patterns may be shown

FOR EACH OPENING:
- Type: "door" or "window"
- Width: in feet (e.g., 3.0 for 3'-0")
- Height: in feet (e.g., 7.0 for 7'-0")
- Tag: door/window type if labeled (D1, W2)

RETURN ONLY:
{
  "openings": [
    {"id": "D1", "type": "door", "width": 3.0, "height": 7.0, "tag": "D1"},
    {"id": "D2", "type": "door", "width": 3.5, "height": 7.0, "tag": "D2-ADA"},
    {"id": "D3", "type": "door", "width": 6.0, "height": 7.0, "tag": "D3-DBL"},
    {"id": "W1", "type": "window", "width": 4.0, "height": 5.0, "tag": "W1"}
  ]
}

Count ALL doors and windows visible on the plan.`;

    try {
      const response = await this.openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: "You are extracting door and window information from a floor plan. Identify all openings with sizes. Return ONLY valid JSON."
          },
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: imageUrl, detail: "high" } }
            ]
          }
        ],
        max_tokens: 3000,
        temperature: 0.0,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) return { openings: [] };

      const parsed = JSON.parse(content.match(/\{[\s\S]*\}/)?.[0] || '{}');
      return { openings: Array.isArray(parsed.openings) ? parsed.openings : [] };
    } catch (error: any) {
      this.logger.warn(`Openings extraction failed: ${error.message}`);
      return { openings: [] };
    }
  }

  /**
   * Pass 5: Extract MEP elements (pipes, ducts, fixtures)
   */
  private async extractMEPOnly(
    imageUrl: string,
    sheetType: string,
    disciplines: string[],
    context: DocumentContext | undefined,
    scale: VisionAnalysisResult['scale'],
    pageIndex: number
  ): Promise<{ pipes: any[]; ducts: any[]; fixtures: any[] }> {
    const scaleInfo = scale ? `Scale: ${scale.detected} (ratio: ${scale.ratio})` : 'Scale unknown - estimate lengths';
    
    // Determine what to extract based on sheet type and disciplines
    const isPlumbing = sheetType === 'fixture' || disciplines.some(d => d.toLowerCase().includes('plumbing'));
    const isMechanical = sheetType === 'rcp' || disciplines.some(d => d.toLowerCase().includes('mechanical'));
    const isElectrical = disciplines.some(d => d.toLowerCase().includes('electrical'));
    
    let prompt = `MEP EXTRACTION - Extract mechanical, electrical, and plumbing elements.

${scaleInfo}

`;

    if (isPlumbing || sheetType === 'floor' || sheetType === 'fixture') {
      prompt += `
## PLUMBING FIXTURES:
- Toilets/Water Closets: oval/elongated symbols
- Urinals: wall-mounted rectangular
- Lavatories/Sinks: round or rectangular basin symbols
- Floor Drains: square with "FD" or cross-hatch
- Water Heaters, Mop Sinks, Drinking Fountains

## PIPE RUNS:
Trace pipes from fixtures to mains:
- CW (Cold Water): often blue/solid lines
- HW (Hot Water): often red/dashed lines
- SAN (Sanitary/Waste): thick lines with flow arrows
- VNT (Vent): thin lines going up
- SD (Storm Drain): may be shown on plumbing plans

For each pipe service, provide:
- service: CW, HW, SAN, VNT, or SD
- diameter: size in inches (1", 2", 4")
- length: total linear feet (trace and sum all segments)

`;
    }

    if (isMechanical || sheetType === 'rcp') {
      prompt += `
## HVAC DUCTWORK:
Trace ducts from equipment to diffusers:
- Main ducts: larger sizes (24x12, 18x10)
- Branch ducts: smaller sizes (12x8, 10x8)
- Round ducts: shown with diameter (12"Ø)

For each duct run:
- size: dimensions (24x12, 12"Ø)
- length: linear feet (trace and sum)
- type: supply/return/exhaust if labeled

## DIFFUSERS & GRILLES:
- Supply diffusers: squares/rectangles with size (12x12, 24x24)
- Return grilles: rectangular, often larger
- Linear diffusers: long narrow slots

`;
    }

    if (isElectrical || sheetType === 'rcp') {
      prompt += `
## LIGHT FIXTURES:
- Count by type designation (Type A, B, C or 1, 2, 3)
- 2x4 troffers (rectangular recessed)
- 2x2 fixtures (square recessed)
- Downlights (small circles)
- Exit signs (labeled "EXIT")
- Emergency lights (marked "EM")

## ELECTRICAL DEVICES:
- Receptacles (duplex, GFI)
- Switches
- Data outlets

`;
    }

    prompt += `
RETURN ONLY:
{
  "fixtures": [
    {"type": "Toilet", "count": 4},
    {"type": "Lavatory", "count": 3},
    {"type": "Light Type A", "count": 24},
    {"type": "Exit Sign", "count": 4}
  ],
  "pipes": [
    {"id": "P1", "service": "SAN", "diameter": 4, "length": 85},
    {"id": "P2", "service": "CW", "diameter": 1, "length": 120}
  ],
  "ducts": [
    {"id": "D1", "size": "24x12", "length": 45},
    {"id": "D2", "size": "12x10", "length": 85}
  ]
}

Count carefully - commercial spaces have many MEP elements.`;

    try {
      const response = await this.openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: "You are extracting MEP (mechanical, electrical, plumbing) elements from a construction drawing. Count fixtures and measure pipe/duct runs. Return ONLY valid JSON."
          },
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: imageUrl, detail: "high" } }
            ]
          }
        ],
        max_tokens: 6000,
        temperature: 0.0,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) return { pipes: [], ducts: [], fixtures: [] };

      const parsed = JSON.parse(content.match(/\{[\s\S]*\}/)?.[0] || '{}');
      return {
        pipes: Array.isArray(parsed.pipes) ? parsed.pipes : [],
        ducts: Array.isArray(parsed.ducts) ? parsed.ducts : [],
        fixtures: Array.isArray(parsed.fixtures) ? parsed.fixtures : []
      };
    } catch (error: any) {
      this.logger.warn(`MEP extraction failed: ${error.message}`);
      return { pipes: [], ducts: [], fixtures: [] };
    }
  }

  /**
   * Get default scale when extraction fails
   */
  private getDefaultScale(): VisionAnalysisResult['scale'] {
    return {
      detected: "1/4\" = 1'-0\" (assumed)",
      units: "ft",
      ratio: 48,
      confidence: "low",
      method: "assumed",
    };
  }

  /**
   * Sum areas from rooms array
   */
  private sumAreas(items: any[] | undefined): number {
    if (!items || !Array.isArray(items)) return 0;
    return items.reduce((sum, item) => sum + (item.area || 0), 0);
  }

  /**
   * Extract using sheet-type specific prompts
   */
  private async extractWithSheetTypePrompt(
    imageUrl: string,
    sheetType: string,
    targets: string[],
    context: DocumentContext | undefined,
    pageIndex: number,
    disciplines: string[] = []
  ): Promise<VisionAnalysisResult> {
    
    // Get sheet-type specific prompt (considering discipline for better accuracy)
    const prompt = this.getSheetTypePrompt(sheetType, targets, context, disciplines);
    
    const response = await this.openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: this.getEnhancedSystemPrompt(sheetType, context)
        },
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: imageUrl, detail: "high" } }
          ]
        }
      ],
      max_tokens: 8000,
      temperature: 0.0,  // Zero temperature for deterministic, consistent results
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("No response from OpenAI");
    }

    const result = this.parseResponse(content, targets);
    
    // If rooms found but no areas, try room area recovery
    if (targets.includes('rooms') && result.rooms?.length > 0) {
      const roomsWithoutAreas = result.rooms.filter(r => !r.area || r.area === 0);
      if (roomsWithoutAreas.length > 0) {
        this.logger.log(`Page ${pageIndex}: Attempting room area recovery for ${roomsWithoutAreas.length} rooms`);
        const recoveredRooms = await this.recoverRoomAreas(imageUrl, result.rooms, context);
        result.rooms = recoveredRooms;
      }
    }
    
    return result;
  }

  /**
   * Get enhanced system prompt based on sheet type
   */
  private getEnhancedSystemPrompt(sheetType: string, context?: DocumentContext): string {
    let systemPrompt = `You are an expert construction document analyst specializing in takeoff and quantity extraction.

CRITICAL ACCURACY RULES:
1. READ dimensions EXACTLY as shown - look for dimension strings like 12'-6", 25'-0", 8'4"
2. TRACE elements systematically - start from one corner, work across the drawing
3. COUNT carefully - commercial buildings have many elements
4. Use REFERENCE DATA when provided - match codes exactly
5. Return valid JSON only - no markdown, no explanations`;

    if (context && context.partitionTypes.length > 0) {
      systemPrompt += `\n\nPARTITION TYPES FROM LEGEND:\n${context.partitionTypes.map(p => `- ${p.id}: ${p.description || p.id}`).join('\n')}`;
    }
    
    if (context && context.roomSchedule.length > 0) {
      systemPrompt += `\n\nROOM SCHEDULE:\n${context.roomSchedule.map(r => `- ${r.roomNumber}: ${r.roomName}`).join('\n')}`;
    }

    // Add sheet-type specific context
    const sheetContext = this.getSheetTypeContext(sheetType);
    if (sheetContext) {
      systemPrompt += `\n\n${sheetContext}`;
    }

    return systemPrompt;
  }

  /**
   * Get context/expectations for each sheet type
   */
  private getSheetTypeContext(sheetType: string): string {
    const contexts: Record<string, string> = {
      'floor': `ARCHITECTURAL FLOOR PLAN EXPECTATIONS:
- Room tags with name and often area (e.g., "OFFICE 150 SF")
- Partition type symbols on walls (circles/hexagons with codes)
- Dimension strings showing wall lengths, room dimensions
- Door and window symbols with size callouts
- A typical commercial space has 200-1000+ LF of partitions`,
      
      'demo_floor': `DEMOLITION FLOOR PLAN:
- Elements marked for demolition (dashed lines, "DEMO" notes)
- Existing walls to remain vs. walls to remove
- Focus on what's being removed, not retained`,
      
      'fixture': `PLUMBING/FIXTURE PLAN EXPECTATIONS:
- Plumbing fixtures: toilets, sinks, urinals, floor drains
- Pipe runs with size callouts (2", 4", etc.)
- Service labels: CW, HW, SAN, VNT, SD
- A typical commercial restroom has 50-200 LF of piping
- Trace pipes from fixtures to mains`,
      
      'rcp': `REFLECTED CEILING PLAN EXPECTATIONS:
- Light fixtures with type designations (A, B, C or 1, 2, 3)
- HVAC diffusers and return grilles with sizes
- Ceiling grid and heights
- Count every fixture symbol carefully
- Commercial spaces often have 20-100+ light fixtures`,
      
      'materials': `FINISH/MATERIALS SCHEDULE:
- Room finish schedule (floor, wall, ceiling, base materials)
- Material legends and specifications
- Extract material types per room`,
    };
    
    return contexts[sheetType] || '';
  }

  /**
   * Get sheet-type specific extraction prompt
   */
  private getSheetTypePrompt(
    sheetType: string,
    targets: string[],
    context: DocumentContext | undefined,
    disciplines: string[] = []
  ): string {
    
    // Check discipline for specialized prompts (even if category is 'other')
    const hasPlumbing = disciplines.some(d => d.toLowerCase().includes('plumbing'));
    const hasMechanical = disciplines.some(d => d.toLowerCase().includes('mechanical'));
    const hasElectrical = disciplines.some(d => d.toLowerCase().includes('electrical'));
    
    // Use specialized prompts based on sheet type OR discipline
    switch (sheetType) {
      case 'floor':
      case 'demo_floor':
        return this.getArchitecturalFloorPlanPrompt(targets, context, sheetType === 'demo_floor');
      
      case 'fixture':
        return this.getPlumbingPlanPrompt(targets, context);
      
      case 'rcp':
        return this.getRCPPrompt(targets, context);
      
      default:
        // For 'other' category, check discipline to use specialized prompts
        if (hasPlumbing && targets.includes('pipes')) {
          return this.getPlumbingPlanPrompt(targets, context);
        }
        if (hasMechanical && targets.includes('ducts')) {
          return this.getMechanicalPlanPrompt(targets, context);
        }
        if (hasElectrical && targets.includes('fixtures')) {
          return this.getElectricalPlanPrompt(targets, context);
        }
        return this.getGenericPrompt(targets, context);
    }
  }

  /**
   * Architectural floor plan specific prompt
   */
  private getArchitecturalFloorPlanPrompt(
    targets: string[],
    context: DocumentContext | undefined,
    isDemotion: boolean = false
  ): string {
    const parts: string[] = [];
    
    parts.push(`Analyze this ${isDemotion ? 'DEMOLITION' : 'ARCHITECTURAL'} FLOOR PLAN and extract the following:\n`);

    if (targets.includes('rooms')) {
      parts.push(`
## ROOMS - Extract ALL room/space information:

LOOK FOR:
1. Room tags (text in center of rooms) - usually format: "ROOM NAME" with area below
2. Room bubbles/circles containing room number
3. Area callouts: numbers followed by "SF", "SQ FT", or "S.F."
4. Dimensions shown as L x W (to calculate area if not labeled)

FOR EACH ROOM PROVIDE:
- id: Room number if shown (e.g., "101", "102")
- name: Exact room name as labeled (e.g., "SALES AREA", "TOILET ROOM")
- area: Square footage - READ from tag or CALCULATE from dimensions (L x W)

CRITICAL: If you see dimensions like 25'-0" x 40'-0", calculate: 25 x 40 = 1000 SF`);
    }

    if (targets.includes('walls')) {
      parts.push(`
## WALLS - Extract ALL partition/wall information:

LOOK FOR:
1. Partition type symbols - circles or hexagons ON the wall lines containing codes (PT-1, A, 1, etc.)
2. Dimension strings along walls: 12'-6", 25'-0", 8'4"
3. Different line weights indicate different wall types
4. Fire-rated walls marked with ratings (1-HR, 2-HR)

EXTRACTION METHOD:
1. Start at top-left of the plan
2. Trace EACH wall segment systematically
3. Note the partition type symbol for each wall
4. Read the length from nearby dimension strings
5. Sum all segments of the same type

FOR EACH WALL TYPE PROVIDE:
- id: Unique identifier (W1, W2, etc.)
- partitionType: The code from the symbol (e.g., "PT-1", "1-HR FIRE WALL")
- length: Total linear feet of THIS wall type (sum all segments)

COMMERCIAL BUILDING EXPECTATION: Total walls should be 200-1000+ LF`);
    }

    if (targets.includes('doors') || targets.includes('windows')) {
      parts.push(`
## OPENINGS - Doors and Windows:

DOORS: Look for door swings (arcs), door tags with sizes (3'-0" x 7'-0")
WINDOWS: Look for window symbols, often rectangular with size callouts

FOR EACH PROVIDE:
- type: "door" or "window"
- width: in feet (e.g., 3.0 for 3'-0")
- height: in feet (e.g., 7.0 for 7'-0")`);
    }

    parts.push(`
## OUTPUT FORMAT - Return ONLY this JSON:
{
  "sheetTitle": "sheet number from title block",
  "scale": {"detected": "1/4\\" = 1'-0\\"", "ratio": 48, "units": "ft", "confidence": "high"},
  "rooms": [
    {"id": "101", "name": "SALES AREA", "area": 1250}
  ],
  "walls": [
    {"id": "W1", "partitionType": "PT-1", "length": 145.5},
    {"id": "W2", "partitionType": "1-HR FIRE WALL", "length": 87.5}
  ],
  "openings": [
    {"type": "door", "width": 3.0, "height": 7.0}
  ],
  "fixtures": [],
  "pipes": [],
  "ducts": [],
  "materials": []
}

BE THOROUGH - trace every wall, read every dimension, calculate every area.`);

    return parts.join('\n');
  }

  /**
   * Plumbing plan specific prompt
   */
  private getPlumbingPlanPrompt(
    targets: string[],
    context: DocumentContext | undefined
  ): string {
    return `Analyze this PLUMBING PLAN and extract:

## FIXTURES - Count ALL plumbing fixtures:
- Toilets/Water Closets (WC) - look for oval/elongated symbols
- Urinals - wall-mounted rectangular symbols
- Lavatories/Sinks - round or rectangular symbols
- Floor drains - square symbols with "FD"
- Mop sinks, drinking fountains, etc.

FOR EACH FIXTURE TYPE:
- type: Fixture name (e.g., "Toilet", "Lavatory", "Floor Drain")
- count: How many of this type

## PIPES - Trace ALL pipe runs:
Pipe labels indicate service:
- CW = Cold Water (often blue or solid lines)
- HW = Hot Water (often red or dashed lines)  
- SAN = Sanitary/Waste (thick lines, flow arrows)
- VNT = Vent (thin lines going up)
- SD = Storm Drain

TRACE each pipe run:
1. Start at fixtures, trace to mains
2. Read diameter from labels (2", 3", 4", etc.)
3. Measure/read length from dimensions
4. Sum all segments of same service type

FOR EACH PIPE SERVICE:
- service: CW, HW, SAN, VNT, or SD
- diameter: Size in inches
- length: Total linear feet

COMMERCIAL EXPECTATION: 
- Sanitary: 50-200 LF typical
- Cold Water: 50-300 LF typical
- Hot Water: 30-200 LF typical

## OUTPUT FORMAT:
{
  "sheetTitle": "P-1",
  "fixtures": [
    {"type": "Toilet", "count": 4},
    {"type": "Lavatory", "count": 3},
    {"type": "Floor Drain", "count": 2}
  ],
  "pipes": [
    {"id": "P1", "service": "SAN", "diameter": 4, "length": 85},
    {"id": "P2", "service": "CW", "diameter": 1, "length": 120},
    {"id": "P3", "service": "HW", "diameter": 1, "length": 95}
  ],
  "rooms": [],
  "walls": [],
  "ducts": [],
  "openings": [],
  "materials": []
}`;
  }

  /**
   * Reflected Ceiling Plan specific prompt
   */
  private getRCPPrompt(
    targets: string[],
    context: DocumentContext | undefined
  ): string {
    return `Analyze this REFLECTED CEILING PLAN (RCP) and extract:

## LIGHT FIXTURES - Count ALL lighting:
Look for fixture symbols - usually circles, rectangles, or custom shapes with type designations.

COMMON TYPES:
- Type A, B, C (or 1, 2, 3) - different fixture models
- 2x4 troffers - rectangular recessed lights
- 2x2 fixtures - square recessed lights
- Downlights - small circles
- Exit signs - labeled "EXIT"
- Emergency lights - often marked "EM"

COUNT each type separately - commercial spaces often have 30-100+ fixtures.

## DUCT DIFFUSERS - Supply and Return:
- Supply diffusers: squares/rectangles with size (12x12, 24x24)
- Return grilles: rectangular, often larger
- Linear diffusers: long narrow slots

## HVAC DUCTS (if visible):
- Main ducts with size labels (12x10, 24x12)
- Branch ducts to diffusers
- Trace runs and sum lengths

## OUTPUT FORMAT:
{
  "sheetTitle": "A-RCP",
  "fixtures": [
    {"type": "Light Type A", "count": 24},
    {"type": "Light Type B", "count": 12},
    {"type": "Exit Sign", "count": 4},
    {"type": "Emergency Light", "count": 6}
  ],
  "ducts": [
    {"id": "D1", "size": "24x12", "length": 45},
    {"id": "D2", "size": "12x10", "length": 85}
  ],
  "rooms": [],
  "walls": [],
  "pipes": [],
  "openings": [],
  "materials": []
}`;
  }

  /**
   * Mechanical/HVAC plan specific prompt
   */
  private getMechanicalPlanPrompt(
    targets: string[],
    context: DocumentContext | undefined
  ): string {
    return `Analyze this MECHANICAL/HVAC PLAN and extract:

## DUCTWORK - Trace ALL duct runs:
Look for rectangular or round duct symbols with size labels.

DUCT LABELS FORMAT:
- Rectangular: 24x12, 18x10, 12x8 (width x height in inches)
- Round: 12"Ø, 10"Ø, 8"Ø (diameter)
- Labels usually appear along the duct line

EXTRACTION METHOD:
1. Start at air handling units (AHU) or rooftop units (RTU)
2. Trace main ducts through the building
3. Follow branch ducts to diffusers/grilles
4. Sum all segments for total length

DUCT TYPES:
- Supply (S) - delivers conditioned air
- Return (R) - returns air to unit
- Exhaust (E) - vents to outside

FOR EACH DUCT RUN:
- size: duct dimensions (e.g., "24x12" or "12Ø")
- length: linear feet (trace and sum)
- type: supply/return/exhaust if labeled

COMMERCIAL EXPECTATION: 100-500+ LF of ductwork typical

## EQUIPMENT:
- RTU/AHU units with model numbers
- VAV boxes
- Exhaust fans

## OUTPUT FORMAT:
{
  "sheetTitle": "M-1",
  "ducts": [
    {"id": "D1", "size": "24x12", "length": 120, "type": "supply"},
    {"id": "D2", "size": "18x10", "length": 85, "type": "supply"},
    {"id": "D3", "size": "16x12", "length": 60, "type": "return"}
  ],
  "fixtures": [
    {"type": "RTU", "count": 2},
    {"type": "VAV Box", "count": 6}
  ],
  "rooms": [],
  "walls": [],
  "pipes": [],
  "openings": [],
  "materials": []
}`;
  }

  /**
   * Electrical plan specific prompt
   */
  private getElectricalPlanPrompt(
    targets: string[],
    context: DocumentContext | undefined
  ): string {
    return `Analyze this ELECTRICAL PLAN and extract:

## LIGHTING FIXTURES - Count ALL lights:
Look for fixture symbols with type designations in the legend.

COMMON SYMBOLS:
- Circles or rectangles with letters (A, B, C) or numbers (1, 2, 3)
- 2x4 troffers (rectangular recessed)
- 2x2 fixtures (square recessed)
- Downlights (small circles)
- Exit signs (marked "EXIT" or with running man symbol)
- Emergency lights (marked "EM" or with battery symbol)

COUNT CAREFULLY - commercial spaces have many fixtures (30-100+)

## DEVICES - Count receptacles and switches:
- Duplex receptacles (two small circles)
- GFI receptacles (often marked "GFI")
- Switches (S, S3 for 3-way)
- Data outlets (triangle symbol)

## PANELS:
- Panel schedules with circuit counts
- Panel locations and names

## OUTPUT FORMAT:
{
  "sheetTitle": "E-1",
  "fixtures": [
    {"type": "Light Type A", "count": 24},
    {"type": "Light Type B", "count": 18},
    {"type": "Exit Sign", "count": 4},
    {"type": "Emergency Light", "count": 6},
    {"type": "Duplex Receptacle", "count": 32},
    {"type": "GFI Receptacle", "count": 8}
  ],
  "rooms": [],
  "walls": [],
  "pipes": [],
  "ducts": [],
  "openings": [],
  "materials": []
}`;
  }

  /**
   * Generic prompt for other sheet types
   */
  private getGenericPrompt(
    targets: string[],
    context: DocumentContext | undefined
  ): string {
    const parts: string[] = [];
    
    parts.push("Analyze this construction drawing and extract the following elements:\n");

    if (targets.includes('rooms')) {
      parts.push(`ROOMS: Identify all rooms with name, number, and area in SF`);
    }
    if (targets.includes('walls')) {
      parts.push(`WALLS: Extract partition types and lengths in linear feet`);
    }
    if (targets.includes('pipes')) {
      parts.push(`PIPES: Identify service type (CW/HW/SAN/VNT), diameter, and length`);
    }
    if (targets.includes('ducts')) {
      parts.push(`DUCTS: Extract duct sizes and lengths`);
    }
    if (targets.includes('fixtures')) {
      parts.push(`FIXTURES: Count all fixtures by type`);
    }

    parts.push(`
OUTPUT FORMAT - Return ONLY valid JSON:
{
  "sheetTitle": "sheet number",
  "rooms": [{"id": "", "name": "", "area": 0}],
  "walls": [{"id": "", "partitionType": "", "length": 0}],
  "pipes": [{"id": "", "service": "", "diameter": 0, "length": 0}],
  "ducts": [{"id": "", "size": "", "length": 0}],
  "fixtures": [{"type": "", "count": 0}],
  "openings": [],
  "materials": []
}`);

    return parts.join('\n');
  }

  /**
   * Attempt to recover room areas with a focused second pass
   */
  private async recoverRoomAreas(
    imageUrl: string,
    rooms: any[],
    context: DocumentContext | undefined
  ): Promise<any[]> {
    const roomNames = rooms.map(r => r.name || r.id).join(', ');
    
    const prompt = `ROOM AREA EXTRACTION - Second Pass

I previously identified these rooms: ${roomNames}

YOUR TASK: Find the AREA for each room.

LOOK FOR:
1. Room tags with area: "ROOM NAME / 1,250 SF" or "ROOM NAME\\n150 SQ FT"
2. Area callouts near room centers
3. Dimensions to calculate: if you see 25'-0" x 50'-0", that's 25 × 50 = 1,250 SF
4. Room schedule table if visible

RETURN only room names with their areas:
{
  "rooms": [
    {"name": "SALES AREA", "area": 1250},
    {"name": "TOILET ROOM", "area": 85},
    {"name": "BACK OF HOUSE", "area": 450}
  ]
}

If area truly cannot be determined, use null (not 0).`;

    try {
      const response = await this.openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: "You are extracting room areas from a construction floor plan. Read dimension strings and calculate areas."
          },
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: imageUrl, detail: "high" } }
            ]
          }
        ],
        max_tokens: 2000,
        temperature: 0.0,  // Zero temperature for deterministic, consistent results
      });

      const content = response.choices[0]?.message?.content;
      if (!content) return rooms;

      const parsed = JSON.parse(content.match(/\{[\s\S]*\}/)?.[0] || '{}');
      
      if (parsed.rooms && Array.isArray(parsed.rooms)) {
        // Merge recovered areas into original rooms
        return rooms.map(room => {
          const recovered = parsed.rooms.find(
            (r: any) => r.name?.toLowerCase() === room.name?.toLowerCase()
          );
          if (recovered?.area && recovered.area > 0) {
            return { ...room, area: recovered.area };
          }
          return room;
        });
      }
    } catch (error: any) {
      this.logger.warn(`Room area recovery failed: ${error.message}`);
    }
    
    return rooms;
  }

  /**
   * Run comprehensive sanity checks on extraction results
   */
  private runSanityChecks(
    result: VisionAnalysisResult,
    sheetType: string,
    targets: string[]
  ): string[] {
    const warnings: string[] = [];
    
    // ===== ROOM SANITY CHECKS =====
    if (targets.includes('rooms') && result.rooms?.length > 0) {
      const totalArea = this.sumAreas(result.rooms);
      const roomsWithoutAreas = result.rooms.filter(r => !r.area || r.area === 0);
      
      // Check for missing areas
      if (roomsWithoutAreas.length > 0) {
        warnings.push(`${roomsWithoutAreas.length} of ${result.rooms.length} rooms missing area data`);
      }
      
      // Check total area is reasonable for commercial (min 500 SF for small retail)
      if (totalArea > 0 && totalArea < 500) {
        warnings.push(`Total area (${totalArea} SF) seems very small for commercial space`);
      }
      
      // Check for suspiciously small rooms (< 30 SF is usually a closet or error)
      const tinyRooms = result.rooms.filter(r => r.area && r.area > 0 && r.area < 30);
      if (tinyRooms.length > 0) {
        warnings.push(`${tinyRooms.length} rooms have very small area (< 30 SF)`);
      }
      
      // Check for duplicate room names
      const roomNames = result.rooms.map(r => r.name?.toLowerCase()).filter(Boolean);
      const uniqueNames = new Set(roomNames);
      if (roomNames.length > uniqueNames.size) {
        warnings.push(`Possible duplicate room names detected`);
      }
    }
    
    // ===== WALL SANITY CHECKS =====
    if (sheetType === 'floor' && targets.includes('walls')) {
      const totalWallLength = this.sumLengths(result.walls);
      const roomCount = result.rooms?.length || 1;
      const expectedMinWalls = roomCount * SANITY_THRESHOLDS.minWallLengthPerRoom;
      
      // Check minimum wall length
      if (totalWallLength < expectedMinWalls && totalWallLength > 0) {
        warnings.push(`Wall length (${totalWallLength} LF) seems low for ${roomCount} rooms - expected at least ${expectedMinWalls} LF`);
      }
      
      // Check for walls without length
      const wallsWithoutLength = result.walls?.filter(w => !w.length || w.length === 0) || [];
      if (wallsWithoutLength.length > 0) {
        warnings.push(`${wallsWithoutLength.length} walls missing length data`);
      }
      
      // Check for unreasonably long single walls (> 200 LF is suspicious)
      const longWalls = result.walls?.filter(w => w.length && w.length > 200) || [];
      if (longWalls.length > 0) {
        warnings.push(`${longWalls.length} walls have very long lengths (> 200 LF) - verify accuracy`);
      }
      
      // Check for duplicate partition types with exact same length (possible extraction error)
      const wallFingerprints = result.walls?.map(w => `${w.partitionType}-${w.length}`);
      const uniqueFingerprints = new Set(wallFingerprints);
      if (wallFingerprints && wallFingerprints.length > uniqueFingerprints.size + 1) {
        warnings.push(`Multiple walls have identical partition type AND length - possible duplicates`);
      }
    }
    
    // ===== PIPE SANITY CHECKS =====
    if (targets.includes('pipes') && result.pipes?.length > 0) {
      const totalPipeLength = this.sumLengths(result.pipes);
      
      // Check minimum pipe length
      if (totalPipeLength > 0 && totalPipeLength < SANITY_THRESHOLDS.minPipeLengthTotal) {
        warnings.push(`Pipe length (${totalPipeLength} LF) seems low for commercial - expected at least ${SANITY_THRESHOLDS.minPipeLengthTotal} LF`);
      }
      
      // Check for pipes without length
      const pipesWithoutLength = result.pipes.filter(p => !p.length || p.length === 0);
      if (pipesWithoutLength.length > 0) {
        warnings.push(`${pipesWithoutLength.length} pipes missing length data`);
      }
      
      // Check for missing essential services (commercial should have at least CW and SAN)
      const services = new Set(result.pipes.map(p => p.service?.toUpperCase()));
      if (!services.has('SAN') && !services.has('SANITARY')) {
        warnings.push(`No sanitary pipes detected - verify plumbing extraction`);
      }
    }
    
    // ===== DUCT SANITY CHECKS =====
    if (targets.includes('ducts') && result.ducts?.length > 0) {
      const totalDuctLength = this.sumLengths(result.ducts);
      
      // Check minimum duct length
      if (totalDuctLength > 0 && totalDuctLength < SANITY_THRESHOLDS.minDuctLengthTotal) {
        warnings.push(`Duct length (${totalDuctLength} LF) seems low - expected at least ${SANITY_THRESHOLDS.minDuctLengthTotal} LF`);
      }
      
      // Check for ducts without size
      const ductsWithoutSize = result.ducts.filter(d => !d.size);
      if (ductsWithoutSize.length > 0) {
        warnings.push(`${ductsWithoutSize.length} ducts missing size data`);
      }
    }
    
    // ===== FIXTURE SANITY CHECKS =====
    if (targets.includes('fixtures') && result.fixtures?.length > 0) {
      const totalFixtures = result.fixtures.reduce((sum, f) => sum + (f.count || 0), 0);
      const roomCount = result.rooms?.length || 1;
      
      // Check for reasonable fixture count
      if (totalFixtures > 0 && totalFixtures < roomCount * SANITY_THRESHOLDS.minFixturesPerRoom) {
        warnings.push(`Fixture count (${totalFixtures}) seems low for ${roomCount} rooms`);
      }
      
      // Check for fixtures with zero count
      const zeroCountFixtures = result.fixtures.filter(f => !f.count || f.count === 0);
      if (zeroCountFixtures.length > 0) {
        warnings.push(`${zeroCountFixtures.length} fixture types have zero count`);
      }
    }
    
    // ===== SCALE SANITY CHECK =====
    if (result.scale?.confidence === 'low') {
      warnings.push(`Scale confidence is low - measurements may be inaccurate`);
    }
    
    return warnings;
  }

  /**
   * Sum lengths from an array of elements
   */
  private sumLengths(items: any[] | undefined): number {
    if (!items || !Array.isArray(items)) return 0;
    return items.reduce((sum, item) => sum + (item.length || 0), 0);
  }

  /**
   * Filter extraction targets based on sheet classification
   */
  private filterTargetsBySheetType(
    targets: string[],
    classification?: { category?: string; isPrimaryPlan?: boolean; discipline?: string[] }
  ): string[] {
    if (!classification?.category) {
      return targets;
    }

    const category = classification.category;
    const filteredTargets: string[] = [];

    for (const target of targets) {
      let shouldInclude = false;

      switch (target) {
        case 'rooms':
          shouldInclude = ROOM_EXTRACTION_CATEGORIES.includes(category) && 
                         (classification.isPrimaryPlan !== false);
          break;
        case 'walls':
          shouldInclude = WALL_EXTRACTION_CATEGORIES.includes(category);
          break;
        case 'pipes':
          shouldInclude = PIPE_EXTRACTION_CATEGORIES.includes(category) ||
                         classification.discipline?.some(d => 
                           d.toLowerCase().includes('plumbing'));
          break;
        case 'ducts':
          shouldInclude = DUCT_EXTRACTION_CATEGORIES.includes(category) ||
                         classification.discipline?.some(d => 
                           d.toLowerCase().includes('mechanical'));
          break;
        case 'fixtures':
          shouldInclude = FIXTURE_EXTRACTION_CATEGORIES.includes(category) ||
                         classification.discipline?.some(d => 
                           d.toLowerCase().includes('electrical') || 
                           d.toLowerCase().includes('plumbing'));
          break;
        case 'doors':
        case 'windows':
          shouldInclude = ROOM_EXTRACTION_CATEGORIES.includes(category);
          break;
        default:
          shouldInclude = true;
      }

      if (shouldInclude) {
        filteredTargets.push(target);
      }
    }

    return filteredTargets;
  }

  private parseResponse(content: string, targets: string[]): VisionAnalysisResult {
    try {
      const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/) || content.match(/\{[\s\S]*\}/);
      const jsonText = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : content;
      
      const parsed = JSON.parse(jsonText);

      return {
        sheetTitle: parsed.sheetTitle,
        rooms: this.validateArray(parsed.rooms, targets.includes("rooms")),
        walls: this.validateArray(parsed.walls, targets.includes("walls")),
        openings: this.validateArray(parsed.openings, targets.includes("doors") || targets.includes("windows")),
        pipes: this.validateArray(parsed.pipes, targets.includes("pipes")),
        ducts: this.validateArray(parsed.ducts, targets.includes("ducts")),
        fixtures: this.validateArray(parsed.fixtures, targets.includes("fixtures")),
        levels: [],
        elevations: [],
        sections: [],
        risers: [],
        scale: this.normalizeScale(parsed.scale),
        materials: this.validateArray(parsed.materials, true),
      };
    } catch (error: any) {
      this.logger.warn(`Failed to parse response: ${error.message}`);
      return this.getEmptyResult();
    }
  }

  private validateArray(items: any[], shouldInclude: boolean): any[] {
    if (!shouldInclude || !Array.isArray(items)) return [];
    return items.map((item, index) => ({
      id: item.id || `item_${index + 1}`,
      ...item
    }));
  }

  private normalizeScale(scale: any): VisionAnalysisResult["scale"] {
    if (!scale || typeof scale !== "object") {
      return {
        detected: "Unknown",
        units: "ft",
        ratio: 48,
        confidence: "low",
        method: "assumed",
      };
    }

    return {
      detected: scale.detected || "Unknown",
      units: scale.units || "ft",
      ratio: typeof scale.ratio === "number" ? scale.ratio : 48,
      confidence: scale.confidence || "medium",
      method: scale.method || "titleblock",
    };
  }

  private getEmptyResult(): VisionAnalysisResult {
    return {
      rooms: [],
      walls: [],
      openings: [],
      pipes: [],
      ducts: [],
      fixtures: [],
      levels: [],
      elevations: [],
      sections: [],
      risers: [],
      scale: {
        detected: "Unknown",
        units: "ft",
        ratio: 48,
        confidence: "low",
        method: "assumed",
      },
      materials: [],
    };
  }

  private detectImageFormat(buffer: Buffer): "png" | "jpeg" {
    if (buffer.length < 3) return "png";
    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    if (buffer.subarray(0, 4).equals(pngHeader)) return "png";
    return "jpeg";
  }
}
