import { Module } from '@nestjs/common';

import { CostIntelligenceService } from './cost-intelligence.service';
import { LaborModelingService } from './labor-modeling.service';

@Module({
  providers: [CostIntelligenceService, LaborModelingService],
  exports: [CostIntelligenceService, LaborModelingService],
})
export class CostIntelligenceModule {}
