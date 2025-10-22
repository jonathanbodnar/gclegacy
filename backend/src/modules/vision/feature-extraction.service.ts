import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/common/prisma/prisma.service';
import { OpenAIVisionService, VisionAnalysisResult } from './openai-vision.service';

@Injectable()
export class FeatureExtractionService {
  private readonly logger = new Logger(FeatureExtractionService.name);

  constructor(
    private prisma: PrismaService,
    private openaiVision: OpenAIVisionService,
  ) {}

  async extractFeatures(
    jobId: string,
    sheetId: string,
    analysisFeatures: any, // Changed from imageBuffer to analysisFeatures
    disciplines: string[],
    targets: string[],
    options?: any
  ): Promise<any[]> {
    this.logger.log(`Extracting features for job ${jobId}, sheet ${sheetId}`);

    try {
      // analysisFeatures already contains the OpenAI Vision results
      // Convert OpenAI results to database features
      const features = await this.convertToFeatures(
        jobId,
        sheetId,
        analysisFeatures,
        targets
      );

      // Save features to database
      await this.saveFeatures(features);

      this.logger.log(`Extracted ${features.length} features for job ${jobId}`);
      return features;

    } catch (error) {
      this.logger.error(`Feature extraction failed for job ${jobId}:`, error.message);
      throw error;
    }
  }

  private async convertToFeatures(
    jobId: string,
    sheetId: string,
    analysis: VisionAnalysisResult,
    targets: string[]
  ): Promise<any[]> {
    const features = [];

    // Convert rooms
    if (targets.includes('rooms')) {
      for (const room of analysis.rooms) {
        features.push({
          jobId,
          sheetId,
          type: 'ROOM',
          props: {
            name: room.name,
            program: room.program,
          },
          area: room.area,
          count: 1,
          // geom would be PostGIS geometry in real implementation
        });
      }
    }

    // Convert walls
    if (targets.includes('walls')) {
      for (const wall of analysis.walls) {
        features.push({
          jobId,
          sheetId,
          type: 'WALL',
          props: {
            partitionType: wall.partitionType,
          },
          length: wall.length,
          count: 1,
          // geom would be PostGIS geometry
        });
      }
    }

    // Convert openings (doors/windows)
    if (targets.includes('doors') || targets.includes('windows')) {
      for (const opening of analysis.openings) {
        features.push({
          jobId,
          sheetId,
          type: 'OPENING',
          props: {
            openingType: opening.type,
            width: opening.width,
            height: opening.height,
          },
          count: 1,
          // geom would be PostGIS geometry
        });
      }
    }

    // Convert pipes
    if (targets.includes('pipes')) {
      for (const pipe of analysis.pipes) {
        features.push({
          jobId,
          sheetId,
          type: 'PIPE',
          props: {
            service: pipe.service,
            diameterIn: pipe.diameter,
          },
          length: pipe.length,
          count: 1,
          // geom would be PostGIS geometry
        });
      }
    }

    // Convert ducts
    if (targets.includes('ducts')) {
      for (const duct of analysis.ducts) {
        features.push({
          jobId,
          sheetId,
          type: 'DUCT',
          props: {
            size: duct.size,
          },
          length: duct.length,
          count: 1,
          // geom would be PostGIS geometry
        });
      }
    }

    // Convert fixtures
    if (targets.includes('fixtures')) {
      for (const fixture of analysis.fixtures) {
        features.push({
          jobId,
          sheetId,
          type: 'FIXTURE',
          props: {
            fixtureType: fixture.type,
          },
          count: fixture.count,
          // geom would be PostGIS geometry
        });
      }
    }

    return features;
  }

  private async saveFeatures(features: any[]): Promise<void> {
    for (const feature of features) {
      await this.prisma.feature.create({
        data: {
          jobId: feature.jobId,
          sheetId: feature.sheetId,
          type: feature.type,
          props: feature.props,
          area: feature.area,
          length: feature.length,
          count: feature.count,
          // geom: feature.geom, // Would be PostGIS geometry
        },
      });
    }
  }

  async enhanceWithAI(features: any[], context: string): Promise<any[]> {
    // Use OpenAI to enhance feature data with additional insights
    try {
      const enhancementPrompt = `Given these extracted building features, provide additional technical insights:

Features: ${JSON.stringify(features, null, 2)}
Context: ${context}

Enhance with:
- Material specifications
- Code compliance notes
- Design recommendations
- Quantity validation
- Missing element detection

Return enhanced features with additional properties.`;

      const response = await this.openaiVision.analyzeText(enhancementPrompt, 'Feature Enhancement');
      
      // Merge AI insights with existing features
      return this.mergeAIInsights(features, response);
      
    } catch (error) {
      this.logger.warn('AI enhancement failed:', error.message);
      return features; // Return original features if enhancement fails
    }
  }

  private mergeAIInsights(originalFeatures: any[], aiInsights: any): any[] {
    // Merge AI-generated insights with extracted features
    return originalFeatures.map((feature, index) => {
      const insights = aiInsights.features?.[index] || {};
      
      return {
        ...feature,
        props: {
          ...feature.props,
          ...insights.additionalProperties,
        },
        aiInsights: {
          recommendations: insights.recommendations,
          codeCompliance: insights.codeCompliance,
          materialSuggestions: insights.materialSuggestions,
        },
      };
    });
  }
}
