import { Injectable, Logger } from '@nestjs/common';
import { OpenAIVisionService } from './openai-vision.service';
import * as sharp from 'sharp';

@Injectable()
export class PlanAnalysisService {
  private readonly logger = new Logger(PlanAnalysisService.name);

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
        // Convert to PNG for analysis
        try {
          const pngBuffer = await sharp(fileBuffer)
            .png()
            .resize(2048, 2048, { fit: 'inside', withoutEnlargement: true })
            .toBuffer();
          return [pngBuffer];
        } catch (error) {
          this.logger.warn(`Failed to convert ${extension} to image:`, error.message);
          throw new Error(`Unsupported file format: ${extension}`);
        }
    }
  }

  private async convertPdfToImages(pdfBuffer: Buffer): Promise<Buffer[]> {
    // In a real implementation, you'd use a library like pdf2pic or pdf-poppler
    // For now, return the buffer as a single "page"
    this.logger.log('PDF to image conversion - using placeholder implementation');
    
    try {
      // Mock: Create a placeholder image for each "page"
      const mockImage = await sharp({
        create: {
          width: 1024,
          height: 768,
          channels: 3,
          background: { r: 255, g: 255, b: 255 }
        }
      })
      .png()
      .toBuffer();
      
      return [mockImage]; // In real implementation, would return array of page images
    } catch (error) {
      throw new Error('PDF processing failed');
    }
  }

  private async convertCadToImages(cadBuffer: Buffer): Promise<Buffer[]> {
    // In a real implementation, you'd use a CAD conversion library
    // For now, create a placeholder image
    this.logger.log('CAD to image conversion - using placeholder implementation');
    
    try {
      const mockImage = await sharp({
        create: {
          width: 1024,
          height: 768,
          channels: 3,
          background: { r: 255, g: 255, b: 255 }
        }
      })
      .png()
      .toBuffer();
      
      return [mockImage];
    } catch (error) {
      throw new Error('CAD processing failed');
    }
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

  private generateSummary(pageResults: any[]): any {
    const summary = {
      totalRooms: 0,
      totalWallLength: 0,
      totalPipeLength: 0,
      totalDuctLength: 0,
      totalFixtures: 0,
      disciplines: new Set<string>(),
    };

    for (const page of pageResults) {
      summary.totalRooms += page.features.rooms?.length || 0;
      summary.totalWallLength += page.features.walls?.reduce((sum: number, w: any) => sum + (w.length || 0), 0) || 0;
      summary.totalPipeLength += page.features.pipes?.reduce((sum: number, p: any) => sum + (p.length || 0), 0) || 0;
      summary.totalDuctLength += page.features.ducts?.reduce((sum: number, d: any) => sum + (d.length || 0), 0) || 0;
      summary.totalFixtures += page.features.fixtures?.reduce((sum: number, f: any) => sum + (f.count || 0), 0) || 0;
      
      if (page.discipline) {
        summary.disciplines.add(page.discipline);
      }
    }

    return {
      ...summary,
      disciplines: Array.from(summary.disciplines),
    };
  }
}
