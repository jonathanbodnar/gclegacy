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
import { SpaceExtractionService } from './space-extraction.service';
import { MaterialsExtractionService } from './materials-extraction.service';
import { ValidationService } from './validation.service';
import { ConsistencyCheckerService } from './consistency-checker.service';
import { DocumentContextService } from './document-context.service';
import { ContextAwareVisionService } from './context-aware-vision.service';

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
    SpaceExtractionService,
    MaterialsExtractionService,
    ValidationService,
    ConsistencyCheckerService,
    DocumentContextService,
    ContextAwareVisionService,
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
    SpaceExtractionService,
    MaterialsExtractionService,
    ValidationService,
    ConsistencyCheckerService,
    DocumentContextService,
    ContextAwareVisionService,
  ],
})
export class VisionModule {}
