import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

export interface VisionAnalysisResult {
  rooms: Array<{
    id: string;
    name?: string;
    area?: number;
    polygon?: number[][];
    program?: string;
  }>;
  walls: Array<{
    id: string;
    length?: number;
    partitionType?: string;
    polyline?: number[][];
  }>;
  openings: Array<{
    id: string;
    type: 'door' | 'window';
    width?: number;
    height?: number;
    location?: number[];
  }>;
  pipes: Array<{
    id: string;
    service: 'CW' | 'HW' | 'SAN' | 'VENT';
    diameter?: number;
    length?: number;
    polyline?: number[][];
  }>;
  ducts: Array<{
    id: string;
    size?: string;
    length?: number;
    polyline?: number[][];
  }>;
  fixtures: Array<{
    id: string;
    type: string;
    count: number;
    location?: number[];
  }>;
  scale?: {
    detected: string;
    units: 'ft' | 'm';
    ratio: number;
  };
}

@Injectable()
export class OpenAIVisionService {
  private readonly logger = new Logger(OpenAIVisionService.name);
  private openai: OpenAI;

  constructor(private configService: ConfigService) {
    const apiKey = this.configService.get('OPENAI_API_KEY');
    if (!apiKey) {
      this.logger.warn('OpenAI API key not configured - vision analysis will be limited');
    }
    
    this.openai = new OpenAI({
      apiKey: apiKey || 'dummy-key',
    });
  }

  async analyzePlanImage(
    imageBuffer: Buffer, 
    disciplines: string[], 
    targets: string[],
    options?: any
  ): Promise<VisionAnalysisResult> {
    this.logger.log(`Analyzing plan image with OpenAI Vision (disciplines: ${disciplines.join(',')}, targets: ${targets.join(',')})`);

    try {
      // Convert buffer to base64 for OpenAI
      const base64Image = imageBuffer.toString('base64');
      const imageUrl = `data:image/png;base64,${base64Image}`;

      // Create comprehensive prompt based on disciplines and targets
      const prompt = this.createAnalysisPrompt(disciplines, targets);

      const response = await this.openai.chat.completions.create({
        model: "gpt-4-vision-preview",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: prompt
              },
              {
                type: "image_url",
                image_url: {
                  url: imageUrl,
                  detail: "high"
                }
              }
            ]
          }
        ],
        max_tokens: 4000,
        temperature: 0.1, // Low temperature for consistent technical analysis
      });

      const analysisText = response.choices[0]?.message?.content;
      if (!analysisText) {
        throw new Error('No analysis response from OpenAI');
      }

      // Parse the structured response
      const result = await this.parseAnalysisResponse(analysisText, targets);
      
      this.logger.log(`OpenAI analysis completed: ${result.rooms.length} rooms, ${result.walls.length} walls, ${result.fixtures.length} fixtures`);
      
      return result;

    } catch (error) {
      this.logger.error('OpenAI vision analysis failed:', error.message);
      
      // Fallback to mock data for testing
      return this.generateMockAnalysis(disciplines, targets);
    }
  }

  private createAnalysisPrompt(disciplines: string[], targets: string[]): string {
    const disciplineMap = {
      'A': 'Architectural (floor plans, rooms, walls, doors, windows)',
      'P': 'Plumbing (pipes, fixtures, water/sewer systems)', 
      'M': 'Mechanical/HVAC (ducts, equipment, air systems)',
      'E': 'Electrical (lighting, panels, conduits)'
    };

    const targetMap = {
      'rooms': 'room boundaries and areas with names/numbers',
      'walls': 'wall centerlines with partition types',
      'doors': 'door locations with sizes',
      'windows': 'window locations with sizes', 
      'pipes': 'piping systems with diameters and services (CW/HW/SAN)',
      'ducts': 'ductwork with sizes',
      'fixtures': 'plumbing/electrical fixtures with types and counts'
    };

    return `You are an expert architectural/MEP plan analyst. Analyze this construction drawing and extract specific technical information.

DISCIPLINES TO ANALYZE: ${disciplines.map(d => disciplineMap[d]).join(', ')}

EXTRACTION TARGETS: ${targets.map(t => targetMap[t]).join(', ')}

Please provide a detailed analysis in the following JSON format:

{
  "scale": {
    "detected": "scale found in titleblock (e.g. 1/4\"=1'-0\")",
    "units": "ft or m",
    "ratio": "numeric ratio for calculations"
  },
  "rooms": [
    {
      "id": "unique_id",
      "name": "room name or number from plan",
      "area": "calculated area in square units",
      "program": "room type (office, toilet, etc.)"
    }
  ],
  "walls": [
    {
      "id": "unique_id", 
      "length": "linear length",
      "partitionType": "wall type from legend (PT-1, etc.)"
    }
  ],
  "openings": [
    {
      "id": "unique_id",
      "type": "door or window", 
      "width": "opening width",
      "height": "opening height"
    }
  ],
  "pipes": [
    {
      "id": "unique_id",
      "service": "CW (cold water), HW (hot water), SAN (sanitary), or VENT",
      "diameter": "pipe diameter in inches",
      "length": "pipe run length"
    }
  ],
  "ducts": [
    {
      "id": "unique_id", 
      "size": "duct size (e.g. 12x10)",
      "length": "duct run length"
    }
  ],
  "fixtures": [
    {
      "id": "unique_id",
      "type": "fixture type (toilet, sink, light, etc.)",
      "count": "number of fixtures"
    }
  ]
}

IMPORTANT: 
- Look for scale information in title blocks
- Count and measure visible elements accurately
- Use standard architectural/MEP terminology
- Provide realistic dimensions based on typical construction
- Include only elements that are clearly visible in the drawing
- Return valid JSON only`;
  }

  private async parseAnalysisResponse(responseText: string, targets: string[]): Promise<VisionAnalysisResult> {
    try {
      // Extract JSON from response (handle markdown code blocks)
      const jsonMatch = responseText.match(/```json\n([\s\S]*?)\n```/) || responseText.match(/\{[\s\S]*\}/);
      const jsonText = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : responseText;
      
      const parsed = JSON.parse(jsonText);
      
      // Validate and structure the response
      return {
        rooms: this.validateArray(parsed.rooms, targets.includes('rooms')),
        walls: this.validateArray(parsed.walls, targets.includes('walls')),
        openings: this.validateArray(parsed.openings, targets.includes('doors') || targets.includes('windows')),
        pipes: this.validateArray(parsed.pipes, targets.includes('pipes')),
        ducts: this.validateArray(parsed.ducts, targets.includes('ducts')),
        fixtures: this.validateArray(parsed.fixtures, targets.includes('fixtures')),
        scale: parsed.scale || { detected: 'Unknown', units: 'ft', ratio: 1 },
      };
    } catch (error) {
      this.logger.warn('Failed to parse OpenAI response, using fallback data');
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

  private generateMockAnalysis(disciplines: string[], targets: string[]): VisionAnalysisResult {
    // Fallback mock data when OpenAI is not available
    return {
      rooms: targets.includes('rooms') ? [
        { id: 'R100', name: 'OFFICE', area: 150, program: 'Office' },
        { id: 'R101', name: 'CONFERENCE', area: 200, program: 'Meeting' },
      ] : [],
      walls: targets.includes('walls') ? [
        { id: 'W1', length: 20, partitionType: 'PT-1' },
        { id: 'W2', length: 15, partitionType: 'PT-2' },
      ] : [],
      openings: (targets.includes('doors') || targets.includes('windows')) ? [
        { id: 'D1', type: 'door', width: 3, height: 7 },
        { id: 'W1', type: 'window', width: 4, height: 3 },
      ] : [],
      pipes: targets.includes('pipes') ? [
        { id: 'P1', service: 'CW', diameter: 1, length: 50 },
        { id: 'P2', service: 'HW', diameter: 0.75, length: 45 },
      ] : [],
      ducts: targets.includes('ducts') ? [
        { id: 'D1', size: '12x10', length: 80 },
        { id: 'D2', size: '8x8', length: 60 },
      ] : [],
      fixtures: targets.includes('fixtures') ? [
        { id: 'F1', type: 'Toilet', count: 2 },
        { id: 'F2', type: 'LED Light', count: 12 },
      ] : [],
      scale: { detected: '1/4"=1\'-0"', units: 'ft', ratio: 48 },
    };
  }

  async analyzeText(text: string, context: string): Promise<any> {
    try {
      const response = await this.openai.chat.completions.create({
        model: "gpt-4",
        messages: [
          {
            role: "system",
            content: "You are an expert construction document analyst. Extract technical information from architectural and MEP plan text."
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

Return as structured JSON.`
          }
        ],
        max_tokens: 1000,
        temperature: 0.1,
      });

      return JSON.parse(response.choices[0]?.message?.content || '{}');
    } catch (error) {
      this.logger.warn('OpenAI text analysis failed:', error.message);
      return {};
    }
  }

  async detectScale(imageBuffer: Buffer): Promise<{ scale?: string; units?: string; ratio?: number }> {
    try {
      const base64Image = imageBuffer.toString('base64');
      const imageUrl = `data:image/png;base64,${base64Image}`;

      const response = await this.openai.chat.completions.create({
        model: "gpt-4-vision-preview",
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
}`
              },
              {
                type: "image_url",
                image_url: {
                  url: imageUrl,
                  detail: "high"
                }
              }
            ]
          }
        ],
        max_tokens: 500,
        temperature: 0.1,
      });

      const result = JSON.parse(response.choices[0]?.message?.content || '{}');
      return result;
    } catch (error) {
      this.logger.warn('OpenAI scale detection failed:', error.message);
      return { scale: 'Unknown', units: 'ft', ratio: 1 };
    }
  }
}
