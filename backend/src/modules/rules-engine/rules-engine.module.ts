import { Module } from '@nestjs/common';
import { RulesEngineService } from './rules-engine.service';
import { RulesEngineController } from './rules-engine.controller';

@Module({
  controllers: [RulesEngineController],
  providers: [RulesEngineService],
  exports: [RulesEngineService],
})
export class RulesEngineModule {}
