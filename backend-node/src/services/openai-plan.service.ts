import OpenAI from 'openai';
import { config } from '../config/env';
import { renderPdfToImages, RenderedPage } from './pdf-renderer';

const SYSTEM_PROMPT = `You are an AI assistant that extracts structured takeoff data from architectural plan images.
Return high-confidence measurements only. Prefer imperial units (feet) when possible.

Targets you may need to extract:
- rooms (area, name, program)
- walls (length, partition type, level)
- doors/windows (width/height)
- pipes/ducts (length, service, diameter or size)
- fixtures (type, count)

Always respond using the requested JSON schema and omit commentary.`;

const pageSchema = {
  name: 'PlanAnalysisPage',
  schema: {
    type: 'object',
    properties: {
      sheetTitle: { type: 'string', description: 'Sheet name or identifier', default: '' },
      discipline: {
        type: 'string',
        description: 'Likely discipline for this sheet (A, P, M, E, or combo)',
        default: 'A',
      },
      scale: { type: 'string', description: 'Plan scale annotation if visible', default: '' },
      units: {
        type: 'string',
        enum: ['ft', 'm'],
        description: 'Units observed on the sheet',
        default: 'ft',
      },
      rooms: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            program: { type: 'string' },
            level: { type: 'string' },
            areaSqFt: { type: 'number' },
          },
          required: ['areaSqFt'],
        },
        default: [],
      },
      walls: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            partitionType: { type: 'string' },
            level: { type: 'string' },
            lengthFt: { type: 'number' },
            heightFt: { type: 'number' },
          },
          required: ['lengthFt'],
        },
        default: [],
      },
      openings: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            openingType: { type: 'string', enum: ['door', 'window'] },
            widthFt: { type: 'number' },
            heightFt: { type: 'number' },
          },
          required: ['openingType'],
        },
        default: [],
      },
      pipes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            service: { type: 'string' },
            diameterIn: { type: 'number' },
            lengthFt: { type: 'number' },
          },
          required: ['lengthFt'],
        },
        default: [],
      },
      ducts: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            size: { type: 'string' },
            service: { type: 'string' },
            lengthFt: { type: 'number' },
          },
          required: ['lengthFt'],
        },
        default: [],
      },
      fixtures: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            fixtureType: { type: 'string' },
            service: { type: 'string' },
            count: { type: 'number' },
          },
          required: ['fixtureType'],
        },
        default: [],
      },
      notes: {
        type: 'array',
        items: { type: 'string' },
        default: [],
      },
    },
    required: ['rooms', 'walls', 'openings', 'pipes', 'ducts', 'fixtures'],
    additionalProperties: false,
  },
  strict: true,
};

export interface PageFeatureSet {
  pageIndex: number;
  sheetTitle: string;
  discipline?: string;
  scale?: string;
  units?: string;
  rooms: Array<{
    id?: string;
    name?: string;
    program?: string;
    level?: string;
    areaSqFt: number;
  }>;
  walls: Array<{
    id?: string;
    partitionType?: string;
    level?: string;
    lengthFt?: number;
    heightFt?: number;
  }>;
  openings: Array<{
    id?: string;
    openingType: 'door' | 'window';
    widthFt?: number;
    heightFt?: number;
  }>;
  pipes: Array<{
    id?: string;
    service?: string;
    diameterIn?: number;
    lengthFt?: number;
  }>;
  ducts: Array<{
    id?: string;
    service?: string;
    size?: string;
    lengthFt?: number;
  }>;
  fixtures: Array<{
    id?: string;
    fixtureType?: string;
    service?: string;
    count?: number;
  }>;
  notes: string[];
}

export interface PlanAnalysisResult {
  pages: PageFeatureSet[];
}

type ResponseContentBlock = {
  type?: string;
  text?: string;
  content?: ResponseContentBlock[];
};

export class OpenAIPlanService {
  private client?: OpenAI;

  constructor() {
    if (config.openAiApiKey) {
      this.client = new OpenAI({
        apiKey: config.openAiApiKey,
      });
    }
  }

  isEnabled(): boolean {
    return Boolean(this.client);
  }

  async analyze(
    pdfBuffer: Buffer,
    fileName: string,
    disciplines: string[],
    targets: string[],
  ): Promise<PlanAnalysisResult> {
    if (!this.client) {
      throw new Error('OpenAI API key not configured');
    }

    const renderedPages = await renderPdfToImages(pdfBuffer, config.openAiMaxPages);
    const pages: PageFeatureSet[] = [];

    for (const page of renderedPages) {
      const analysis = await this.analyzePage(page, fileName, disciplines, targets);
      pages.push(analysis);
    }

    return { pages };
  }

  private async analyzePage(
    rendered: RenderedPage,
    fileName: string,
    disciplines: string[],
    targets: string[],
  ): Promise<PageFeatureSet> {
    if (!this.client) {
      throw new Error('OpenAI client is unavailable');
    }

    const base64 = rendered.buffer.toString('base64');
    const response = await this.client.responses.create({
      model: config.openAiModel,
      temperature: config.openAiTemperature,
      max_output_tokens: 1200,
      input: [
        {
          role: 'system',
          content: [
            {
              type: 'input_text',
              text: SYSTEM_PROMPT,
            },
          ],
        },
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: [
                `File: ${fileName}`,
                `Page index: ${rendered.pageIndex}`,
                `Disciplines to prioritize: ${disciplines.join(', ') || 'ALL'}`,
                `Targets requested: ${targets.join(', ')}`,
                'Extract only measurable geometry (no guesses).',
                'Return a JSON object that matches this schema exactly:',
                JSON.stringify(pageSchema.schema),
              ].join('\n'),
            },
            {
              type: 'input_image',
              image_url: `data:image/png;base64,${base64}`,
              detail: 'high',
            },
          ],
        },
      ],
    });

    const jsonText = this.extractOutputText(response);
    const sanitized = this.sanitizeJsonOutput(jsonText);
    const parsed = JSON.parse(sanitized);
    return {
      pageIndex: rendered.pageIndex,
      sheetTitle: parsed.sheetTitle || `Sheet ${rendered.pageIndex + 1}`,
      discipline: parsed.discipline,
      scale: parsed.scale,
      units: parsed.units,
      rooms: parsed.rooms ?? [],
      walls: parsed.walls ?? [],
      openings: parsed.openings ?? [],
      pipes: parsed.pipes ?? [],
      ducts: parsed.ducts ?? [],
      fixtures: parsed.fixtures ?? [],
      notes: parsed.notes ?? [],
    };
  }

  private extractOutputText(response: OpenAI.Responses.Response): string {
    const outputs = (response.output ?? []) as Array<{ content?: ResponseContentBlock[] }>;
    for (const output of outputs) {
      for (const block of output.content ?? []) {
        if (typeof block.text === 'string' && block.text.trim().length > 0) {
          return block.text;
        }
        const nested = block.content?.find(
          (child) => typeof child.text === 'string' && child.text.trim().length > 0,
        );
        if (nested && nested.text) {
          return nested.text;
        }
      }
    }
    return '{}';
  }

  private sanitizeJsonOutput(raw: string): string {
    let text = raw.trim();

    // Remove markdown fences like ```json ... ```
    if (text.startsWith('```')) {
      const firstNewline = text.indexOf('\n');
      if (firstNewline !== -1) {
        text = text.slice(firstNewline + 1);
      }
      if (text.endsWith('```')) {
        text = text.slice(0, -3);
      }
    }

    // If stray fences remain, strip all ``` occurrences
    text = text.replace(/```/g, '').trim();

    // Attempt to extract the JSON object if extra commentary exists
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace >= firstBrace) {
      text = text.slice(firstBrace, lastBrace + 1);
    }

    return text;
  }
}

