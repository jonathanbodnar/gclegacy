import { Module } from '@nestjs/common';
import { IngestService } from './ingest.service';
import { PdfIngestService } from './pdf-ingest.service';
import { DwgIngestService } from './dwg-ingest.service';
import { BimIngestService } from './bim-ingest.service';
import { FilesModule } from '../files/files.module';

@Module({
  imports: [FilesModule],
  providers: [
    IngestService,
    PdfIngestService,
    DwgIngestService,
    BimIngestService,
  ],
  exports: [IngestService],
})
export class IngestModule {}
