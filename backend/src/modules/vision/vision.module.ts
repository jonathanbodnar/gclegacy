import { Module } from '@nestjs/common';
import { OpenAIVisionService } from './openai-vision.service';
import { PlanAnalysisService } from './plan-analysis.service';
import { FeatureExtractionService } from './feature-extraction.service';

@Module({
  providers: [
    OpenAIVisionService,
    PlanAnalysisService, 
    FeatureExtractionService,
  ],
  exports: [
    OpenAIVisionService,
    PlanAnalysisService,
    FeatureExtractionService,
  ],
})
export class VisionModule {}
