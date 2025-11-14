import { Module } from '@nestjs/common';
import { OpenAIVisionService } from './openai-vision.service';
import { PlanAnalysisService } from './plan-analysis.service';
import { FeatureExtractionService } from './feature-extraction.service';
import { TakeoffAggregatorService } from './takeoff-aggregator.service';

@Module({
  providers: [
    OpenAIVisionService,
    PlanAnalysisService, 
    FeatureExtractionService,
    TakeoffAggregatorService,
  ],
  exports: [
    OpenAIVisionService,
    PlanAnalysisService,
    FeatureExtractionService,
    TakeoffAggregatorService,
  ],
})
export class VisionModule {}
