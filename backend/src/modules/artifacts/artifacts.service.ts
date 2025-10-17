import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/common/prisma/prisma.service';
import { StorageService } from '../files/storage.service';

export interface ArtifactsResponse {
  jobId: string;
  overlays: OverlayArtifact[];
  vectors: VectorArtifact[];
  reports: ReportArtifact[];
  meta: {
    generatedAt: string;
    expiresAt: string;
  };
}

export interface OverlayArtifact {
  sheetId: string;
  type: string;
  url: string;
  description?: string;
}

export interface VectorArtifact {
  sheetId: string;
  format: string;
  url: string;
  description?: string;
}

export interface ReportArtifact {
  type: string;
  format: string;
  url: string;
  description?: string;
}

@Injectable()
export class ArtifactsService {
  constructor(
    private prisma: PrismaService,
    private storageService: StorageService,
  ) {}

  async getArtifacts(jobId: string): Promise<ArtifactsResponse> {
    // Verify job exists
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      include: {
        sheets: true,
      },
    });

    if (!job) {
      throw new NotFoundException('Job not found');
    }

    const expiresIn = 3600; // 1 hour
    const expiresAt = new Date(Date.now() + expiresIn * 1000);

    // Generate signed URLs for overlays
    const overlays: OverlayArtifact[] = [];
    const vectors: VectorArtifact[] = [];

    for (const sheet of job.sheets) {
      // Overlay artifacts (visual representations)
      const overlayTypes = ['rooms', 'walls', 'pipes', 'ducts', 'fixtures'];
      
      for (const type of overlayTypes) {
        try {
          const url = await this.storageService.getArtifactSignedUrl(
            jobId,
            sheet.id,
            `${type}.png`,
            expiresIn,
          );
          
          overlays.push({
            sheetId: sheet.id,
            type,
            url,
            description: `${type} overlay for ${sheet.name || `Sheet ${sheet.index + 1}`}`,
          });
        } catch (error) {
          // Artifact may not exist yet - skip
          continue;
        }
      }

      // Vector artifacts (geometric data)
      const vectorFormats = ['geojson', 'dxf'];
      
      for (const format of vectorFormats) {
        try {
          const url = await this.storageService.getArtifactSignedUrl(
            jobId,
            sheet.id,
            format,
            expiresIn,
          );
          
          vectors.push({
            sheetId: sheet.id,
            format,
            url,
            description: `${format.toUpperCase()} vector data for ${sheet.name || `Sheet ${sheet.index + 1}`}`,
          });
        } catch (error) {
          // Artifact may not exist yet - skip
          continue;
        }
      }
    }

    // Report artifacts (job-level reports)
    const reports: ReportArtifact[] = [];
    const reportTypes = [
      { type: 'takeoff-summary', format: 'pdf' },
      { type: 'materials-report', format: 'pdf' },
      { type: 'qc-report', format: 'pdf' },
    ];

    for (const report of reportTypes) {
      try {
        const url = await this.storageService.getSignedUrl(
          `reports/${jobId}/${report.type}.${report.format}`,
          expiresIn,
        );
        
        reports.push({
          type: report.type,
          format: report.format,
          url,
          description: this.getReportDescription(report.type),
        });
      } catch (error) {
        // Report may not exist yet - skip
        continue;
      }
    }

    return {
      jobId,
      overlays,
      vectors,
      reports,
      meta: {
        generatedAt: new Date().toISOString(),
        expiresAt: expiresAt.toISOString(),
      },
    };
  }

  private getReportDescription(type: string): string {
    const descriptions: Record<string, string> = {
      'takeoff-summary': 'Comprehensive takeoff summary report',
      'materials-report': 'Detailed materials list and pricing',
      'qc-report': 'Quality control and validation report',
    };

    return descriptions[type] || `${type} report`;
  }

  async generateArtifacts(jobId: string): Promise<void> {
    // This method would be called by the job processor to generate artifacts
    // after feature extraction is complete
    
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      include: {
        sheets: true,
        features: true,
      },
    });

    if (!job) {
      throw new NotFoundException('Job not found');
    }

    // Generate overlay images for each sheet
    for (const sheet of job.sheets) {
      await this.generateOverlayImages(jobId, sheet, job.features);
      await this.generateVectorFiles(jobId, sheet, job.features);
    }

    // Generate reports
    await this.generateReports(jobId, job);
  }

  private async generateOverlayImages(jobId: string, sheet: any, features: any[]): Promise<void> {
    // This would use a rendering service to create overlay images
    // showing extracted features on top of the original plans
    
    const sheetFeatures = features.filter(f => f.sheetId === sheet.id);
    
    // Group features by type
    const featuresByType = sheetFeatures.reduce((groups, feature) => {
      const type = feature.type.toLowerCase();
      if (!groups[type]) groups[type] = [];
      groups[type].push(feature);
      return groups;
    }, {} as Record<string, any[]>);

    // Generate overlay for each feature type
    for (const [type, typeFeatures] of Object.entries(featuresByType)) {
      const overlayImage = await this.createOverlayImage(sheet, typeFeatures, type);
      
      await this.storageService.uploadArtifact(
        jobId,
        sheet.id,
        `${type}.png`,
        overlayImage,
        'image/png',
      );
    }
  }

  private async generateVectorFiles(jobId: string, sheet: any, features: any[]): Promise<void> {
    // This would generate vector files (GeoJSON, DXF) from extracted features
    
    const sheetFeatures = features.filter(f => f.sheetId === sheet.id);
    
    // Generate GeoJSON
    const geoJson = this.createGeoJSON(sheetFeatures);
    const geoJsonBuffer = Buffer.from(JSON.stringify(geoJson, null, 2));
    
    await this.storageService.uploadArtifact(
      jobId,
      sheet.id,
      'geojson',
      geoJsonBuffer,
      'application/json',
    );

    // Generate DXF (would require a DXF generation library)
    // const dxfBuffer = await this.createDXF(sheetFeatures);
    // await this.storageService.uploadArtifact(jobId, sheet.id, 'dxf', dxfBuffer, 'application/dxf');
  }

  private async generateReports(jobId: string, job: any): Promise<void> {
    // This would generate PDF reports using a library like Puppeteer or PDFKit
    
    // Generate takeoff summary report
    const summaryReport = await this.createTakeoffSummaryReport(job);
    await this.storageService.uploadFile(
      `reports/${jobId}/takeoff-summary.pdf`,
      summaryReport,
      'application/pdf',
    );

    // Generate materials report
    const materialsReport = await this.createMaterialsReport(job);
    await this.storageService.uploadFile(
      `reports/${jobId}/materials-report.pdf`,
      materialsReport,
      'application/pdf',
    );

    // Generate QC report
    const qcReport = await this.createQCReport(job);
    await this.storageService.uploadFile(
      `reports/${jobId}/qc-report.pdf`,
      qcReport,
      'application/pdf',
    );
  }

  // Mock implementations - in production these would create actual images/files
  private async createOverlayImage(sheet: any, features: any[], type: string): Promise<Buffer> {
    // This would use a rendering library to create overlay images
    // For now, return a mock PNG buffer
    return Buffer.from('mock-png-data');
  }

  private createGeoJSON(features: any[]): any {
    return {
      type: 'FeatureCollection',
      features: features.map(feature => ({
        type: 'Feature',
        id: feature.id,
        properties: {
          type: feature.type,
          ...feature.props,
        },
        geometry: {
          type: 'Point', // Would be actual geometry from PostGIS
          coordinates: [0, 0],
        },
      })),
    };
  }

  private async createTakeoffSummaryReport(job: any): Promise<Buffer> {
    // Would generate PDF using PDFKit or similar
    return Buffer.from('mock-pdf-summary');
  }

  private async createMaterialsReport(job: any): Promise<Buffer> {
    // Would generate PDF materials report
    return Buffer.from('mock-pdf-materials');
  }

  private async createQCReport(job: any): Promise<Buffer> {
    // Would generate quality control report
    return Buffer.from('mock-pdf-qc');
  }
}
