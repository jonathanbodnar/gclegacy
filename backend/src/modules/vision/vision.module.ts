import { Module } from '@nestjs/common';
import { OpenAIVisionService } from './openai-vision.service';
import { PlanAnalysisService } from './plan-analysis.service';
import { FeatureExtractionService } from './feature-extraction.service';
import { TakeoffAggregatorService } from './takeoff-aggregator.service';
import { SheetClassificationService } from './sheet-classification.service';
import { RoomScheduleExtractionService } from './room-schedule-extraction.service';
import { RoomSpatialMappingService } from './room-spatial-mapping.service';
import { PartitionTypeExtractionService } from './partition-type-extraction.service';
import { WallRunExtractionService } from './wall-run-extraction.service';
import { CeilingHeightExtractionService } from './ceiling-height-extraction.service';
import { FinalDataFusionService } from './final-data-fusion.service';
import { ScaleExtractionService } from './scale-extraction.service';

@Module({
  providers: [
    OpenAIVisionService,
    PlanAnalysisService, 
    FeatureExtractionService,
    TakeoffAggregatorService,
    SheetClassificationService,
    RoomScheduleExtractionService,
    RoomSpatialMappingService,
    PartitionTypeExtractionService,
    WallRunExtractionService,
    CeilingHeightExtractionService,
    FinalDataFusionService,
    ScaleExtractionService,
  ],
  exports: [
    OpenAIVisionService,
    PlanAnalysisService,
    FeatureExtractionService,
    TakeoffAggregatorService,
    SheetClassificationService,
    RoomScheduleExtractionService,
    RoomSpatialMappingService,
    PartitionTypeExtractionService,
    WallRunExtractionService,
    CeilingHeightExtractionService,
    FinalDataFusionService,
    ScaleExtractionService,
  ],
})
export class VisionModule {}
