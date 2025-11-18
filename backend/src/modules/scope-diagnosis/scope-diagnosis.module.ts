import { Module } from '@nestjs/common';

import { ScopeDiagnosisService } from './scope-diagnosis.service';

@Module({
  providers: [ScopeDiagnosisService],
  exports: [ScopeDiagnosisService],
})
export class ScopeDiagnosisModule {}
