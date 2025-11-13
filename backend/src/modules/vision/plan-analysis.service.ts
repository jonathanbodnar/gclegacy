import { Injectable, Logger } from '@nestjs/common';
import { OpenAIVisionService, VisionAnalysisResult } from './openai-vision.service';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { spawn } from 'child_process';

@Injectable()
export class PlanAnalysisService {
  private readonly logger = new Logger(PlanAnalysisService.name);
  private static readonly PLACEHOLDER_PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=',
    'base64'
  );

  constructor(private openaiVision: OpenAIVisionService) {}

  async analyzePlanFile(
    fileBuffer: Buffer,
    fileName: string,
    disciplines: string[],
    targets: string[],
    options?: any
  ): Promise<any> {
    this.logger.log(`Starting plan analysis for ${fileName}`);

    try {
      // Convert PDF pages or plan sheets to images for vision analysis
      const images = await this.convertToImages(fileBuffer, fileName);
      
      const results = [];
      
      for (const [pageIndex, imageBuffer] of images.entries()) {
        this.logger.log(`Analyzing page ${pageIndex + 1}/${images.length}`);
        
        // Use OpenAI Vision to analyze each page
        const pageResult = await this.openaiVision.analyzePlanImage(
          imageBuffer,
          disciplines,
          targets,
          options
        );
        
        // Detect scale for this page
        const scaleInfo = await this.openaiVision.detectScale(imageBuffer);
        
        results.push({
          pageIndex,
          fileName: `${fileName}_page_${pageIndex + 1}`,
          discipline: this.detectDisciplineFromContent(pageResult, disciplines),
          scale: scaleInfo,
          features: pageResult,
          metadata: {
            imageSize: imageBuffer.length,
            analysisTimestamp: new Date().toISOString(),
            viewType: this.detectViewType(pageResult),
          }
        });
      }

      return {
        fileName,
        totalPages: images.length,
        pages: results,
        summary: this.generateSummary(results),
      };

    } catch (error) {
      this.logger.error(`Plan analysis failed for ${fileName}:`, error.message);
      throw error;
    }
  }

  private async convertToImages(fileBuffer: Buffer, fileName: string): Promise<Buffer[]> {
    const extension = fileName.split('.').pop()?.toLowerCase();
    
    switch (extension) {
      case 'pdf':
        return this.convertPdfToImages(fileBuffer);
      case 'dwg':
      case 'dxf':
        return this.convertCadToImages(fileBuffer);
      case 'png':
      case 'jpg':
      case 'jpeg':
        // Already an image
        return [fileBuffer];
      default:
        this.logger.warn(`Unsupported file extension "${extension}" - using placeholder image`);
        return [PlanAnalysisService.PLACEHOLDER_PNG];
    }
  }

  private async convertPdfToImages(pdfBuffer: Buffer): Promise<Buffer[]> {
    const density = parseInt(process.env.PDF_RENDER_DPI || '220', 10);
    const maxPages = parseInt(process.env.PDF_RENDER_MAX_PAGES || '5', 10);

    try {
      const mupdfBuffers = await this.convertPdfWithMuPDF(
        pdfBuffer,
        Math.max(1, maxPages),
        density
      );
      if (mupdfBuffers.length > 0) {
        return mupdfBuffers;
      }
    } catch (mupdfError) {
      this.logger.error(`MuPDF conversion failed: ${mupdfError.message}`);
    }

    try {
      const fallbackBuffers = await this.convertPdfWithPdf2Pic(
        pdfBuffer,
        density,
        Math.max(1, maxPages)
      );

      if (fallbackBuffers.length > 0) {
        return fallbackBuffers;
      }
    } catch (pdf2picError) {
      this.logger.error(`pdf2pic conversion failed: ${pdf2picError.message}`);
    }

    this.logger.warn('Falling back to placeholder image for PDF conversion');
    return [PlanAnalysisService.PLACEHOLDER_PNG];
  }

  private async convertPdfWithMuPDF(
    pdfBuffer: Buffer,
    maxPages: number,
    dpi: number
  ): Promise<Buffer[]> {
    const mutoolPath = process.env.MUTOOL_PATH || 'mutool';
    const tempDir = await fs.mkdtemp(join(tmpdir(), 'mupdf-'));
    const inputPath = join(tempDir, `${randomUUID()}.pdf`);
    await fs.writeFile(inputPath, pdfBuffer);

    const outputPattern = join(tempDir, 'page-%d.png');
    const pageRange = `${1}-${Math.max(1, maxPages)}`;
    const args = [
      'draw',
      '-F', 'png',
      '-o', outputPattern,
      '-r', `${dpi}`,
      inputPath,
      pageRange,
    ];

    try {
      await this.spawnCommand(mutoolPath, args);

      const buffers: Buffer[] = [];
      const files = await fs.readdir(tempDir);
      const pageFiles = files
        .filter(name => name.startsWith('page-') && name.endsWith('.png'))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

      for (const file of pageFiles) {
        const buffer = await fs.readFile(join(tempDir, file));
        buffers.push(buffer);
      }

      return buffers;
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async convertPdfWithPdf2Pic(
    pdfBuffer: Buffer,
    density: number,
    maxPages: number
  ): Promise<Buffer[]> {
    const pdf2picModule = await import('pdf2pic');
    const fromBuffer =
      (pdf2picModule as any).fromBuffer ||
      pdf2picModule.default?.fromBuffer;

    if (!fromBuffer) {
      throw new Error('pdf2pic fromBuffer helper not available');
    }

    const convert = fromBuffer(pdfBuffer, {
      density,
      format: 'png',
      width: 2048,
      height: 2048,
      preserveAspectRatio: true,
    });

    const images: Buffer[] = [];
    for (let page = 1; page <= Math.max(1, maxPages); page++) {
      try {
        const result = await convert(page);
        if (!result?.base64) {
          break;
        }
        images.push(Buffer.from(result.base64, 'base64'));
      } catch (error) {
        if (page === 1) {
          throw error;
        }
        break;
      }
    }

    return images;
  }


  private async spawnCommand(command: string, args: string[]): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(command, args, { stdio: 'pipe' });
      let stderr = '';

      proc.stderr.on('data', chunk => {
        stderr += chunk.toString();
      });

      proc.on('error', reject);
      proc.on('close', code => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(stderr || `Command exited with code ${code}`));
        }
      });
    });
  }

  private async convertCadToImages(cadBuffer: Buffer): Promise<Buffer[]> {
    // In a real implementation, you'd use a CAD conversion library
    this.logger.log('CAD to image conversion - using placeholder implementation');
    return [PlanAnalysisService.PLACEHOLDER_PNG];
  }

  private detectDisciplineFromContent(content: any, requestedDisciplines: string[]): string {
    // Analyze the extracted content to determine the most likely discipline
    const scores = {
      'A': 0,
      'P': 0, 
      'M': 0,
      'E': 0,
    };

    // Score based on feature types found
    if (content.rooms?.length > 0 || content.walls?.length > 0) scores['A'] += 2;
    if (content.openings?.length > 0) scores['A'] += 1;
    if (content.pipes?.length > 0) scores['P'] += 3;
    if (content.ducts?.length > 0) scores['M'] += 3;
    if (content.fixtures?.some((f: any) => f.type.toLowerCase().includes('light'))) scores['E'] += 2;
    if (content.fixtures?.some((f: any) => ['toilet', 'sink', 'faucet'].some(t => f.type.toLowerCase().includes(t)))) scores['P'] += 2;

    // Return the highest scoring discipline that was requested
    const sortedDisciplines = Object.entries(scores)
      .filter(([discipline]) => requestedDisciplines.includes(discipline))
      .sort(([,a], [,b]) => b - a);

    return sortedDisciplines[0]?.[0] || requestedDisciplines[0] || 'A';
  }

  private detectViewType(content: VisionAnalysisResult): 'plan' | 'vertical' | 'mixed' {
    const hasVertical =
      (content.elevations?.length || 0) > 0 ||
      (content.sections?.length || 0) > 0 ||
      (content.risers?.length || 0) > 0;
    const hasPlan =
      (content.rooms?.length || 0) > 0 ||
      (content.walls?.length || 0) > 0 ||
      (content.openings?.length || 0) > 0;

    if (hasVertical && hasPlan) return 'mixed';
    if (hasVertical) return 'vertical';
    return 'plan';
  }

  private generateSummary(pageResults: any[]): any {
    const summary = {
      totalRooms: 0,
      totalWallLength: 0,
      totalPipeLength: 0,
      totalDuctLength: 0,
      totalFixtures: 0,
      totalElevations: 0,
      totalSections: 0,
      totalRisers: 0,
      totalRiserHeight: 0,
      disciplines: new Set<string>(),
      levelsMap: new Map<string, { elevationFt?: number; heightFt?: number }>(),
      defaultStoryHeightFt: undefined as number | undefined,
    };

    for (const page of pageResults) {
      const features = page.features as VisionAnalysisResult;

      summary.totalRooms += features.rooms?.length || 0;
      summary.totalWallLength += features.walls?.reduce((sum: number, w: any) => sum + (w.length || 0), 0) || 0;
      summary.totalPipeLength += features.pipes?.reduce((sum: number, p: any) => sum + (p.length || 0), 0) || 0;
      summary.totalDuctLength += features.ducts?.reduce((sum: number, d: any) => sum + (d.length || 0), 0) || 0;
      summary.totalFixtures += features.fixtures?.reduce((sum: number, f: any) => sum + (f.count || 0), 0) || 0;

      summary.totalElevations += features.elevations?.length || 0;
      summary.totalSections += features.sections?.length || 0;
      summary.totalRisers += features.risers?.length || 0;
      summary.totalRiserHeight += features.risers?.reduce((sum: number, r: any) => sum + (r.heightFt || 0), 0) || 0;

      if (!summary.defaultStoryHeightFt && features.verticalMetadata?.defaultStoryHeightFt) {
        summary.defaultStoryHeightFt = features.verticalMetadata.defaultStoryHeightFt;
      }

      features.levels?.forEach(level => {
        const key = level.name || level.id;
        if (!summary.levelsMap.has(key)) {
          summary.levelsMap.set(key, {
            elevationFt: level.elevationFt,
            heightFt: level.heightFt,
          });
        }
      });
      
      if (page.discipline) {
        summary.disciplines.add(page.discipline);
      }
    }

    return {
      totalRooms: summary.totalRooms,
      totalWallLength: summary.totalWallLength,
      totalPipeLength: summary.totalPipeLength,
      totalDuctLength: summary.totalDuctLength,
      totalFixtures: summary.totalFixtures,
      totalElevations: summary.totalElevations,
      totalSections: summary.totalSections,
      totalRisers: summary.totalRisers,
      totalRiserHeight: summary.totalRiserHeight,
      defaultStoryHeightFt: summary.defaultStoryHeightFt,
      disciplines: Array.from(summary.disciplines),
      levels: Array.from(summary.levelsMap.entries()).map(([name, data]) => ({
        name,
        ...data,
      })),
    };
  }
}
