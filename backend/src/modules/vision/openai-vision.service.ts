import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import OpenAI from "openai";
import { appendVisionLog } from "./vision.logger";

export interface VisionAnalysisResult {
  sheetTitle?: string;
  rooms: Array<{
    id: string;
    name?: string;
    area?: number;
    polygon?: number[][];
    program?: string | null;
    level?: string;
    heightFt?: number;
  }>;
  walls: Array<{
    id: string;
    length?: number;
    partitionType?: string;
    polyline?: number[][];
    level?: string;
    heightFt?: number;
  }>;
  openings: Array<{
    id: string;
    type: "door" | "window";
    width?: number;
    height?: number;
    location?: number[];
    level?: string;
  }>;
  pipes: Array<{
    id: string;
    service: "CW" | "HW" | "SAN" | "VENT";
    diameter?: number;
    length?: number;
    polyline?: number[][];
    level?: string;
    heightFt?: number;
  }>;
  ducts: Array<{
    id: string;
    size?: string;
    length?: number;
    polyline?: number[][];
    level?: string;
    heightFt?: number;
  }>;
  fixtures: Array<{
    id: string;
    type: string;
    count: number;
    location?: number[];
    level?: string;
    heightFt?: number;
  }>;
  levels?: Array<{
    id: string;
    name: string;
    elevationFt?: number;
    heightFt?: number;
  }>;
  elevations?: Array<{
    id: string;
    face?: string;
    widthFt?: number;
    heightFt?: number;
    fromLevel?: string;
    toLevel?: string;
    notes?: string;
  }>;
  sections?: Array<{
    id: string;
    description?: string;
    fromLevel?: string;
    toLevel?: string;
    heightFt?: number;
  }>;
  risers?: Array<{
    id: string;
    system?: string;
    levels: string[];
    heightFt?: number;
    qty?: number;
  }>;
  verticalMetadata?: {
    defaultStoryHeightFt?: number;
    totalStories?: number;
    referenceDatum?: string;
    notes?: string[];
  };
  scale?: {
    detected: string;
    units: "ft" | "m";
    ratio: number;
  };
}

@Injectable()
export class OpenAIVisionService {
  private readonly logger = new Logger(OpenAIVisionService.name);
  private openai: OpenAI;
  private allowMockFallback: boolean;

  constructor(private configService: ConfigService) {
    const apiKey = this.configService.get("OPENAI_API_KEY");
    if (!apiKey) {
      this.logger.warn(
        "OpenAI API key not configured - vision analysis will be limited"
      );
    }

    this.openai = new OpenAI({
      apiKey: apiKey || "dummy-key",
    });
    this.allowMockFallback =
      (this.configService.get("VISION_ALLOW_MOCK") || "false").toLowerCase() ===
      "true";
  }

  async analyzePlanImage(
    imageBuffer: Buffer,
    disciplines: string[],
    targets: string[],
    options?: any
  ): Promise<VisionAnalysisResult> {
    this.logger.log(
      `Analyzing plan image with OpenAI Vision (disciplines: ${disciplines.join(",")}, targets: ${targets.join(",")})`
    );

    try {
      // Validate image buffer before processing
      this.validateImageBuffer(imageBuffer);

      // Determine image format from buffer
      const imageFormat = this.detectImageFormat(imageBuffer);
      if (!imageFormat) {
        throw new Error(
          "Invalid image format: buffer must be a valid PNG or JPEG"
        );
      }

      // Convert buffer to base64 for OpenAI
      const base64Image = imageBuffer.toString("base64");
      const imageUrl = `data:image/${imageFormat};base64,${base64Image}`;

      // Create comprehensive prompt based on disciplines and targets
      const prompt = this.createAnalysisPrompt(disciplines, targets);

      const response = await this.openai.chat.completions.create({
        model: "gpt-5-mini-2025-08-07",
        messages: [
          {
            role: "system",
            content: `You are an expert architectural/MEP plan analyst with full visual access to the provided drawing.
Return VALID JSON only that matches the requested schema.
If data is missing, use nulls or empty arrays—never apologize or say you cannot analyze.
Do not add prose, markdown, or explanations beyond the JSON object.`,
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: prompt,
              },
              {
                type: "image_url",
                image_url: {
                  url: imageUrl,
                  detail: "high",
                },
              },
            ],
          },
        ],
        max_completion_tokens: 4000,
      });

      const analysisText = response.choices[0]?.message?.content;
      if (!analysisText) {
        throw new Error("No analysis response from OpenAI");
      }

      if (this.isRefusalResponse(analysisText)) {
        await appendVisionLog("OpenAI vision refusal", {
          disciplines,
          targets,
          message: analysisText.slice(0, 500),
        });
        throw new Error(
          "OpenAI vision model refused the request (insufficient access or policy restriction)"
        );
      }

      await appendVisionLog("OpenAI vision raw response", {
        disciplines,
        targets,
        length: analysisText.length,
        preview: analysisText.slice(0, 500),
        timestamp: new Date().toISOString(),
      });

      // Parse the structured response
      const result = await this.parseAnalysisResponse(analysisText, targets);

      this.logger.log(
        `OpenAI analysis completed: ${result.rooms.length} rooms, ${result.walls.length} walls, ${result.fixtures.length} fixtures`
      );

      return result;
    } catch (error) {
      this.logger.error("OpenAI vision analysis failed:", error.message);
      await appendVisionLog("OpenAI vision analysis failed", {
        disciplines,
        targets,
        error: error.message,
      });

      // Fallback to mock data for testing
      if (this.allowMockFallback) {
        return this.generateMockAnalysis(disciplines, targets);
      }
      throw error;
    }
  }

  private createAnalysisPrompt(
    disciplines: string[],
    targets: string[]
  ): string {
    const disciplineMap = {
      A: "Architectural (floor plans, rooms, walls, doors, windows)",
      P: "Plumbing (pipes, fixtures, water/sewer systems)",
      M: "Mechanical/HVAC (ducts, equipment, air systems)",
      E: "Electrical (lighting, panels, conduits)",
    };

    const targetMap = {
      rooms: "room boundaries and areas with names/numbers",
      walls: "wall centerlines with partition types",
      doors: "door locations with sizes",
      windows: "window locations with sizes",
      pipes: "piping systems with diameters and services (CW/HW/SAN)",
      ducts: "ductwork with sizes",
      fixtures: "plumbing/electrical fixtures with types and counts",
      levels: "building levels with elevations and clear heights",
      elevations: "exterior/interior elevations that show story heights",
      sections:
        "section cuts indicating vertical dimensions and structural relationships",
      risers:
        "vertical riser diagrams for plumbing/mechanical/electrical systems",
    };

    const wantsVertical = {
      levels: targets.includes("levels"),
      elevations: targets.includes("elevations"),
      sections: targets.includes("sections"),
      risers: targets.includes("risers"),
    };
    const verticalRequested = Object.values(wantsVertical).some(Boolean);

    const jsonSections: string[] = [
      `  "sheetTitle": "exact sheet number/name from title block (e.g. A-101, S-201, I401) - read from title block, not generic names",
  "scale": {
    "detected": "scale found in titleblock (e.g. 1/4\\"=1'-0\\")",
    "units": "ft or m",
    "ratio": "numeric ratio for calculations"
  }`,
      `  "rooms": [
    {
      "id": "unique_id",
      "name": "room name or number from plan (read exact text)",
      "area": "calculated area in square units",
      "polygon": [[x1,y1], [x2,y2], [x3,y3], [x1,y1]] - closed polygon (first and last point must match),
      "program": "ONLY if explicitly labeled on plan - use null if not shown, DO NOT guess"
    }
  ]`,
      `  "walls": [
    {
      "id": "unique_id", 
      "length": "linear length (must be > 0)",
      "partitionType": "wall type from legend (PT-1, EXT-1, etc.)",
      "polyline": [[x1,y1], [x2,y2]] - wall centerline with at least 2 distinct points
    }
  ]`,
      `  "openings": [
    {
      "id": "unique_id",
      "type": "door or window", 
      "width": "opening width",
      "height": "opening height"
    }
  ]`,
      `  "pipes": [
    {
      "id": "unique_id",
      "service": "CW (cold water), HW (hot water), SAN (sanitary), or VENT",
      "diameter": "pipe diameter in inches",
      "length": "pipe run length"
    }
  ]`,
      `  "ducts": [
    {
      "id": "unique_id", 
      "size": "duct size (e.g. 12x10)",
      "length": "duct run length"
    }
  ]`,
      `  "fixtures": [
    {
      "id": "unique_id",
      "type": "fixture type (toilet, sink, light, etc.)",
      "count": "number of fixtures"
    }
  ]`,
    ];

    if (wantsVertical.levels) {
      jsonSections.push(`  "levels": [
    {
      "id": "L1",
      "name": "Level 1",
      "elevationFt": 0,
      "heightFt": 12
    }
  ]`);
    }

    if (wantsVertical.elevations) {
      jsonSections.push(`  "elevations": [
    {
      "id": "ELEV-A",
      "face": "South",
      "fromLevel": "Level 1",
      "toLevel": "Roof",
      "heightFt": 24,
      "notes": "Parapet @ 27'-0\\""
    }
  ]`);
    }

    if (wantsVertical.sections) {
      jsonSections.push(`  "sections": [
    {
      "id": "SEC-A",
      "description": "Building section through core",
      "fromLevel": "Level 1",
      "toLevel": "Roof",
      "heightFt": 24
    }
  ]`);
    }

    if (wantsVertical.risers) {
      jsonSections.push(`  "risers": [
    {
      "id": "R-PCW",
      "system": "Plumbing CW",
      "levels": ["Level 1", "Level 2", "Roof"],
      "heightFt": 24,
      "qty": 1
    }
  ],
  "verticalMetadata": {
    "defaultStoryHeightFt": 12,
    "totalStories": 2,
    "referenceDatum": "Level 1 = 0'-0\\"",
    "notes": [
      "Parapet is 3' above roof",
      "Mezzanine at 9'-0\\" A.F.F."
    ]
  }`);
    }

    const verticalInstruction = verticalRequested
      ? "\n- Capture vertical information (story heights, level names, risers) whenever available"
      : "";

    const wallRules = targets.includes("walls")
      ? `\n\nCRITICAL WALL EXTRACTION RULES:
- Extract ONLY actual walls (partition lines, structural walls, demising walls)
- DO NOT include: columns (circular/square structural elements), furniture, equipment, casework, dimension lines, text, symbols, or annotations
- Columns are typically shown as filled circles/squares and should be EXCLUDED
- Wall polylines must have at least 2 distinct coordinate points with non-zero length
- Each wall segment should be a continuous line - do not create 0-length walls
- If a wall is interrupted by a door/window, treat it as separate wall segments`
      : "";

    const roomRules = targets.includes("rooms")
      ? `\n\nCRITICAL ROOM EXTRACTION RULES:
- Room polygons must be closed shapes (first and last coordinates must match)
- Polygon must have at least 3 distinct vertices to form a valid area
- Extract room program/type ONLY if explicitly labeled on the plan (e.g., "OFFICE", "TOILET", "STORAGE")
- If room type is not labeled, set program to null - DO NOT guess or infer room types`
      : "";

    return `You are an expert architectural/MEP plan analyst. Analyze this construction drawing and extract specific technical information.

DISCIPLINES TO ANALYZE: ${disciplines.map((d) => disciplineMap[d]).join(", ")}

EXTRACTION TARGETS: ${targets.map((t) => targetMap[t]).join(", ")}

SHEET TITLE EXTRACTION:
- Read the EXACT sheet number/name from the title block (typically in lower right corner)
- Look for patterns like: "SHEET NO.", "DRAWING NO.", "SHEET", or similar labels
- Extract the actual sheet identifier (e.g., "A-101", "S-201", "I401", "A1.01")
- Do NOT use generic names like "Page 1" or duplicate the same name for all sheets

Please provide a detailed analysis in the following JSON format:

{
${jsonSections.join(",\n\n")}
}

IMPORTANT: 
- Look for scale information in title blocks
- Count and measure visible elements accurately
- Use standard architectural/MEP terminology
- Provide realistic dimensions based on typical construction
- Include only elements that are clearly visible in the drawing${verticalInstruction}${wallRules}${roomRules}
- Return valid JSON only`;
  }

  private async parseAnalysisResponse(
    responseText: string,
    targets: string[]
  ): Promise<VisionAnalysisResult> {
    try {
      // Extract JSON from response (handle markdown code blocks)
      const jsonMatch =
        responseText.match(/```json\n([\s\S]*?)\n```/) ||
        responseText.match(/\{[\s\S]*\}/);
      const jsonText = jsonMatch ? jsonMatch[1] || jsonMatch[0] : responseText;

      const parsed = JSON.parse(jsonText);

      // Validate and structure the response
      return {
        sheetTitle:
          typeof parsed.sheetTitle === "string"
            ? parsed.sheetTitle.trim()
            : undefined,
        rooms: this.validateAndFilterRooms(
          parsed.rooms,
          targets.includes("rooms")
        ),
        walls: this.validateAndFilterWalls(
          parsed.walls,
          targets.includes("walls")
        ),
        openings: this.validateArray(
          parsed.openings,
          targets.includes("doors") || targets.includes("windows")
        ),
        pipes: this.validateArray(parsed.pipes, targets.includes("pipes")),
        ducts: this.validateArray(parsed.ducts, targets.includes("ducts")),
        fixtures: this.validateArray(
          parsed.fixtures,
          targets.includes("fixtures")
        ),
        levels: this.validateArray(parsed.levels, targets.includes("levels")),
        elevations: this.validateArray(
          parsed.elevations,
          targets.includes("elevations")
        ),
        sections: this.validateArray(
          parsed.sections,
          targets.includes("sections")
        ),
        risers: this.validateArray(parsed.risers, targets.includes("risers")),
        verticalMetadata: this.normalizeVerticalMetadata(
          parsed.verticalMetadata
        ),
        scale: parsed.scale || { detected: "Unknown", units: "ft", ratio: 1 },
      };
    } catch (error) {
      this.logger.warn("Failed to parse OpenAI response, using fallback data");
      await appendVisionLog("Vision JSON parse failure", {
        error: error.message,
        responsePreview: responseText?.slice(0, 1000),
      });
      return this.generateMockAnalysis([], targets);
    }
  }

  private validateArray(items: any[], shouldInclude: boolean): any[] {
    if (!shouldInclude || !Array.isArray(items)) return [];

    return items.map((item, index) => ({
      id: item.id || `item_${index + 1}`,
      ...item,
    }));
  }

  private validateAndFilterRooms(
    rooms: any[],
    shouldInclude: boolean
  ): VisionAnalysisResult["rooms"] {
    if (!shouldInclude || !Array.isArray(rooms)) return [];

    const validRooms: VisionAnalysisResult["rooms"] = [];

    for (const room of rooms) {
      // Validate polygon if present
      if (room.polygon) {
        const polygon = room.polygon;
        if (!Array.isArray(polygon) || polygon.length < 3) {
          this.logger.debug(
            `Skipping room ${room.id}: invalid polygon (needs at least 3 vertices)`
          );
          continue;
        }

        // Check if polygon is closed (first and last points should match)
        const first = polygon[0];
        const last = polygon[polygon.length - 1];
        const isClosed =
          Array.isArray(first) &&
          Array.isArray(last) &&
          first.length >= 2 &&
          last.length >= 2 &&
          Math.abs(first[0] - last[0]) < 0.001 &&
          Math.abs(first[1] - last[1]) < 0.001;

        if (!isClosed) {
          this.logger.debug(
            `Room ${room.id}: polygon not closed, auto-closing by duplicating first point`
          );
          // Auto-close the polygon
          room.polygon = [...polygon, [first[0], first[1]]];
        }

        // Validate all coordinates are valid numbers
        const hasInvalidCoords = room.polygon.some(
          (pt: any) =>
            !Array.isArray(pt) ||
            pt.length < 2 ||
            !Number.isFinite(pt[0]) ||
            !Number.isFinite(pt[1])
        );
        if (hasInvalidCoords) {
          this.logger.debug(
            `Skipping room ${room.id}: polygon has invalid coordinates`
          );
          continue;
        }
      }

      // Ensure program is null if not explicitly provided (don't guess)
      const program =
        room.program && typeof room.program === "string" && room.program.trim()
          ? room.program.trim()
          : null;

      validRooms.push({
        id: room.id || `room_${validRooms.length + 1}`,
        name: room.name,
        area: this.toNumber(room.area),
        polygon: room.polygon,
        program: program,
        level: room.level,
        heightFt: this.toNumber(room.heightFt),
      });
    }

    this.logger.log(
      `Validated ${validRooms.length} rooms (filtered ${rooms.length - validRooms.length} invalid)`
    );
    return validRooms;
  }

  private validateAndFilterWalls(
    walls: any[],
    shouldInclude: boolean
  ): VisionAnalysisResult["walls"] {
    if (!shouldInclude || !Array.isArray(walls)) return [];

    const validWalls: VisionAnalysisResult["walls"] = [];

    for (const wall of walls) {
      // Validate length - must be > 0
      const length = this.toNumber(wall.length);
      if (!length || length <= 0) {
        this.logger.debug(
          `Skipping wall ${wall.id}: invalid or zero length (${length})`
        );
        continue;
      }

      // Validate polyline if present
      if (wall.polyline) {
        const polyline = wall.polyline;
        if (!Array.isArray(polyline) || polyline.length < 2) {
          this.logger.debug(
            `Skipping wall ${wall.id}: invalid polyline (needs at least 2 points)`
          );
          continue;
        }

        // Check for distinct points (not all the same)
        const firstPoint = polyline[0];
        const allSame = polyline.every(
          (pt: any) =>
            Array.isArray(pt) &&
            pt.length >= 2 &&
            Math.abs(pt[0] - firstPoint[0]) < 0.001 &&
            Math.abs(pt[1] - firstPoint[1]) < 0.001
        );
        if (allSame) {
          this.logger.debug(
            `Skipping wall ${wall.id}: all polyline points are the same (0-length wall)`
          );
          continue;
        }

        // Validate all coordinates are valid numbers
        const hasInvalidCoords = polyline.some(
          (pt: any) =>
            !Array.isArray(pt) ||
            pt.length < 2 ||
            !Number.isFinite(pt[0]) ||
            !Number.isFinite(pt[1])
        );
        if (hasInvalidCoords) {
          this.logger.debug(
            `Skipping wall ${wall.id}: polyline has invalid coordinates`
          );
          continue;
        }

        // Calculate actual length from polyline to validate against reported length
        let calculatedLength = 0;
        for (let i = 1; i < polyline.length; i++) {
          const dx = polyline[i][0] - polyline[i - 1][0];
          const dy = polyline[i][1] - polyline[i - 1][1];
          calculatedLength += Math.sqrt(dx * dx + dy * dy);
        }
        if (calculatedLength < 0.001) {
          this.logger.debug(
            `Skipping wall ${wall.id}: calculated polyline length is zero`
          );
          continue;
        }
      }

      // Filter out columns and non-wall symbols
      // Columns are typically small, square/circular elements
      // Check if this might be a column based on characteristics
      const partitionType = wall.partitionType?.toLowerCase() || "";
      const isColumn =
        partitionType.includes("column") ||
        partitionType.includes("col") ||
        (wall.polyline && wall.polyline.length === 4 && length < 2.0); // Small square-like shape < 2ft is likely a column

      if (isColumn) {
        this.logger.debug(
          `Skipping wall ${wall.id}: identified as column, not a wall`
        );
        continue;
      }

      validWalls.push({
        id: wall.id || `wall_${validWalls.length + 1}`,
        length: length,
        partitionType: wall.partitionType,
        polyline: wall.polyline,
        level: wall.level,
        heightFt: this.toNumber(wall.heightFt),
      });
    }

    this.logger.log(
      `Validated ${validWalls.length} walls (filtered ${walls.length - validWalls.length} invalid/columns)`
    );
    return validWalls;
  }

  private toNumber(value: any): number | undefined {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const parsed = parseFloat(value);
      return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
  }

  private normalizeVerticalMetadata(
    meta: any
  ): VisionAnalysisResult["verticalMetadata"] {
    if (!meta || typeof meta !== "object") {
      return undefined;
    }

    const coerceNumber = (value: any): number | undefined => {
      if (typeof value === "number") return value;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : undefined;
    };

    return {
      defaultStoryHeightFt: coerceNumber(meta.defaultStoryHeightFt),
      totalStories: coerceNumber(meta.totalStories),
      referenceDatum:
        typeof meta.referenceDatum === "string"
          ? meta.referenceDatum
          : undefined,
      notes: Array.isArray(meta.notes)
        ? meta.notes.filter((n: any) => typeof n === "string")
        : undefined,
    };
  }

  private isRefusalResponse(text: string): boolean {
    if (!text) return false;
    const lower = text.toLowerCase();
    const refusalPhrases = [
      "i'm unable to analyze",
      "i am unable to analyze",
      "i can't analyze",
      "as an ai language model",
      "cannot view images",
      "do not have the ability to view",
    ];
    return refusalPhrases.some((phrase) => lower.includes(phrase));
  }

  private generateMockAnalysis(
    disciplines: string[],
    targets: string[]
  ): VisionAnalysisResult {
    // Fallback mock data when OpenAI is not available
    return {
      sheetTitle: "A-101",
      rooms: targets.includes("rooms")
        ? [
            { id: "R100", name: "OFFICE", area: 150, program: "Office" },
            { id: "R101", name: "CONFERENCE", area: 200, program: "Meeting" },
          ]
        : [],
      walls: targets.includes("walls")
        ? [
            { id: "W1", length: 20, partitionType: "PT-1" },
            { id: "W2", length: 15, partitionType: "PT-2" },
          ]
        : [],
      openings:
        targets.includes("doors") || targets.includes("windows")
          ? [
              { id: "D1", type: "door", width: 3, height: 7 },
              { id: "W1", type: "window", width: 4, height: 3 },
            ]
          : [],
      pipes: targets.includes("pipes")
        ? [
            { id: "P1", service: "CW", diameter: 1, length: 50 },
            { id: "P2", service: "HW", diameter: 0.75, length: 45 },
          ]
        : [],
      ducts: targets.includes("ducts")
        ? [
            { id: "D1", size: "12x10", length: 80 },
            { id: "D2", size: "8x8", length: 60 },
          ]
        : [],
      fixtures: targets.includes("fixtures")
        ? [
            { id: "F1", type: "Toilet", count: 2 },
            { id: "F2", type: "LED Light", count: 12 },
          ]
        : [],
      levels: targets.includes("levels")
        ? [
            { id: "L1", name: "Level 1", elevationFt: 0, heightFt: 12 },
            { id: "L2", name: "Level 2", elevationFt: 12, heightFt: 12 },
          ]
        : [],
      elevations: targets.includes("elevations")
        ? [
            {
              id: "ELEV-A",
              face: "South",
              fromLevel: "L1",
              toLevel: "Roof",
              heightFt: 24,
            },
          ]
        : [],
      sections: targets.includes("sections")
        ? [
            {
              id: "SEC-A",
              description: "Section through core",
              fromLevel: "L1",
              toLevel: "Roof",
              heightFt: 24,
            },
          ]
        : [],
      risers: targets.includes("risers")
        ? [
            {
              id: "R-CW",
              system: "Cold Water",
              levels: ["L1", "L2", "Roof"],
              heightFt: 24,
              qty: 1,
            },
          ]
        : [],
      verticalMetadata: targets.some((t) =>
        ["levels", "elevations", "sections", "risers"].includes(t)
      )
        ? {
            defaultStoryHeightFt: 12,
            totalStories: 2,
            referenceDatum: "Level 1 = 0'-0\"",
          }
        : undefined,
      scale: { detected: '1/4"=1\'-0"', units: "ft", ratio: 48 },
    };
  }

  async analyzeText(text: string, context: string): Promise<any> {
    try {
      const response = await this.openai.chat.completions.create({
        model: "gpt-5-mini-2025-08-07",
        messages: [
          {
            role: "system",
            content:
              "You are an expert construction document analyst. Extract technical information from architectural and MEP plan text.",
          },
          {
            role: "user",
            content: `Analyze this text from a construction drawing and extract relevant technical information:

Context: ${context}

Text: ${text}

Extract:
- Scale information (e.g. 1/4"=1'-0")
- Room names and numbers
- Equipment schedules
- Material specifications
- Dimension callouts

Return as structured JSON.`,
          },
        ],
        max_completion_tokens: 1000,
      });

      return JSON.parse(response.choices[0]?.message?.content || "{}");
    } catch (error) {
      this.logger.warn("OpenAI text analysis failed:", error.message);
      return {};
    }
  }

  async detectScale(
    imageBuffer: Buffer
  ): Promise<{ scale?: string; units?: string; ratio?: number }> {
    try {
      const base64Image = imageBuffer.toString("base64");
      const imageUrl = `data:image/png;base64,${base64Image}`;

      const response = await this.openai.chat.completions.create({
        model: "gpt-5-mini-2025-08-07",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Analyze this architectural drawing and find the scale information. Look for:

1. Title block scale notation (e.g. "1/4" = 1'-0", "1:100", "SCALE: 1/8" = 1'-0")
2. Dimension strings with measurements
3. Standard architectural elements for scale reference (doors ~3', ceiling grids ~2'x2')

Return ONLY a JSON object with:
{
  "scale": "exact scale text found",
  "units": "ft or m", 
  "ratio": "numeric ratio for pixel-to-real conversion",
  "confidence": "high/medium/low",
  "method": "titleblock/dimensions/reference"
}`,
              },
              {
                type: "image_url",
                image_url: {
                  url: imageUrl,
                  detail: "high",
                },
              },
            ],
          },
        ],
        max_completion_tokens: 500,
      });

      const result = JSON.parse(response.choices[0]?.message?.content || "{}");
      return result;
    } catch (error) {
      this.logger.warn("OpenAI scale detection failed:", error.message);
      return { scale: "Unknown", units: "ft", ratio: 1 };
    }
  }

  private validateImageBuffer(buffer: Buffer): void {
    if (!buffer || buffer.length === 0) {
      throw new Error("Image buffer is empty or null");
    }

    // Check minimum size (1KB minimum for a valid image)
    if (buffer.length < 1024) {
      throw new Error(
        `Image buffer too small: ${buffer.length} bytes (minimum 1KB required)`
      );
    }

    // Check maximum size (OpenAI limit is 20MB)
    const maxSize = 20 * 1024 * 1024; // 20MB
    if (buffer.length > maxSize) {
      throw new Error(
        `Image too large: ${buffer.length} bytes (maximum ${maxSize} bytes)`
      );
    }

    // Validate image format headers
    const pngHeader = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    const jpegHeader = Buffer.from([0xff, 0xd8, 0xff]);
    const jpegHeader2 = Buffer.from([0xff, 0xd8, 0xff, 0xe0]); // JPEG with JFIF
    const jpegHeader3 = Buffer.from([0xff, 0xd8, 0xff, 0xe1]); // JPEG with EXIF

    const isPng = buffer.subarray(0, 8).equals(pngHeader);
    const isJpeg =
      buffer.subarray(0, 3).equals(jpegHeader) ||
      buffer.subarray(0, 4).equals(jpegHeader2) ||
      buffer.subarray(0, 4).equals(jpegHeader3);

    if (!isPng && !isJpeg) {
      throw new Error(
        "Invalid image format: buffer must start with PNG or JPEG headers. " +
          `First bytes: ${buffer.subarray(0, 8).toString("hex")}`
      );
    }
  }

  private detectImageFormat(buffer: Buffer): "png" | "jpeg" | null {
    if (!buffer || buffer.length < 3) {
      return null;
    }

    // Check PNG header
    const pngHeader = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    if (buffer.subarray(0, 8).equals(pngHeader)) {
      return "png";
    }

    // Check JPEG header
    const jpegHeader = Buffer.from([0xff, 0xd8, 0xff]);
    if (buffer.subarray(0, 3).equals(jpegHeader)) {
      return "jpeg";
    }

    return null;
  }
}
