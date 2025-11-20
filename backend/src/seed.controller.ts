import { Controller, Post, Delete } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { PrismaService } from './common/prisma/prisma.service';

const MOCK_JOB_ID = 'mock-test-job-001';
const MOCK_FILE_CHECKSUM = 'mock-test-job-2024';

@ApiTags('Seed')
@Controller('seed')
export class SeedController {
  constructor(private prisma: PrismaService) {}

  @Delete('mock-job')
  @ApiOperation({ summary: 'Reset mock job data' })
  async resetMockJob() {
    console.log('🧹 Cleaning up existing mock job data...');
    
    await prisma.material.deleteMany({ where: { jobId: MOCK_JOB_ID } });
    await prisma.feature.deleteMany({ where: { jobId: MOCK_JOB_ID } });
    await prisma.sheet.deleteMany({ where: { jobId: MOCK_JOB_ID } });
    await prisma.job.deleteMany({ where: { id: MOCK_JOB_ID } });
    await prisma.file.deleteMany({ where: { checksum: MOCK_FILE_CHECKSUM } });
    
    return { success: true, message: 'Mock job data cleared' };
  }

  @Post('mock-job')
  @ApiOperation({ summary: 'Seed mock job for testing' })
  async seedMockJob() {
    console.log('🌱 Seeding mock job...');
    
    // Reset first
    await this.resetMockJob();

    // Create file
    const file = await prisma.file.create({
      data: {
        filename: 'Mock Commercial Building - MEP Plans.pdf',
        mime: 'application/pdf',
        pages: 15,
        checksum: MOCK_FILE_CHECKSUM,
        size: BigInt(5242880),
        tags: ['test', 'commercial', 'mock'],
        storageKey: 'mock/commercial-building-2024.pdf',
        storageUrl: 'https://example.com/mock.pdf',
      },
    });

    // Create job
    const job = await prisma.job.create({
      data: {
        id: MOCK_JOB_ID,
        fileId: file.id,
        status: 'COMPLETED',
        disciplines: ['A', 'P', 'M', 'E'],
        targets: ['rooms', 'walls', 'pipes', 'ducts', 'fixtures'],
        startedAt: new Date('2024-11-15T10:00:00Z'),
        finishedAt: new Date('2024-11-15T10:15:00Z'),
        progress: 100,
      },
    });

    // Create features
    const features = [];

    // Rooms
    const rooms = [
      { name: 'Sales Floor', area: 2500 },
      { name: 'Back of House', area: 800 },
      { name: 'Office', area: 300 },
      { name: 'Restroom 1', area: 120 },
      { name: 'Restroom 2', area: 120 },
    ];

    for (const room of rooms) {
      features.push(await prisma.feature.create({
        data: {
          jobId: job.id,
          type: 'ROOM',
          area: room.area,
          props: { name: room.name, ceilingHeight: 10 },
        },
      }));
    }

    // Walls
    for (let i = 0; i < 4; i++) {
      features.push(await prisma.feature.create({
        data: {
          jobId: job.id,
          type: 'WALL',
          length: [180, 90, 60, 120][i],
          area: [180, 90, 60, 120][i] * 10,
          props: { height: 10, wallType: i < 3 ? 'Drywall' : 'CMU' },
        },
      }));
    }

    // Doors & Windows as OPENING type
    for (let i = 0; i < 5; i++) {
      features.push(await prisma.feature.create({
        data: {
          jobId: job.id,
          type: 'OPENING',
          area: 21,
          count: 1,
          props: { openingType: 'DOOR', width: 3, height: 7 },
        },
      }));
    }

    for (let i = 0; i < 10; i++) {
      features.push(await prisma.feature.create({
        data: {
          jobId: job.id,
          type: 'OPENING',
          area: 20,
          count: 1,
          props: { openingType: 'WINDOW', width: 4, height: 5 },
        },
      }));
    }

    // Pipes
    const pipes = [
      { length: 250, diameter: 1, service: 'CW', material: 'Copper Type L' },
      { length: 250, diameter: 1, service: 'HW', material: 'Copper Type L' },
      { length: 180, diameter: 3, service: 'Sanitary', material: 'PVC DWV' },
      { length: 120, diameter: 4, service: 'Sanitary', material: 'PVC DWV' },
      { length: 80, diameter: 2, service: 'Vent', material: 'PVC DWV' },
    ];

    for (const pipe of pipes) {
      features.push(await prisma.feature.create({
        data: {
          jobId: job.id,
          type: 'PIPE',
          length: pipe.length,
          props: {
            diameterIn: pipe.diameter,
            service: pipe.service,
            material: pipe.material,
          },
        },
      }));
    }

    // Ducts
    for (let i = 0; i < 3; i++) {
      features.push(await prisma.feature.create({
        data: {
          jobId: job.id,
          type: 'DUCT',
          length: [180, 120, 90][i],
          props: { width: 12, height: 8 },
        },
      }));
    }

    // Fixtures
    const fixtures = [
      { type: 'Water Closet', count: 4, manufacturer: 'Kohler', model: 'K-3989' },
      { type: 'Lavatory', count: 4, manufacturer: 'American Standard', model: 'Studio' },
      { type: 'Urinal', count: 2, manufacturer: 'Sloan', model: 'WEUS-1000' },
      { type: 'Water Heater', count: 1, manufacturer: 'Rheem', model: 'RTGH-95DVLN' },
    ];

    for (const fixture of fixtures) {
      features.push(await prisma.feature.create({
        data: {
          jobId: job.id,
          type: 'FIXTURE',
          count: fixture.count,
          props: {
            fixtureType: fixture.type,
            manufacturer: fixture.manufacturer,
            model: fixture.model,
          },
        },
      }));
    }

    // Create materials
    const materials = [
      { sku: 'VCT-12X12-STANDARD', qty: 4224, uom: 'SF' },
      { sku: 'PAINT-INT-EGGSHELL', qty: 4410, uom: 'SF' },
      { sku: 'ACT-2X2-STANDARD', qty: 4147, uom: 'SF' },
      { sku: 'COPPER-L-1IN', qty: 583, uom: 'LF' },
      { sku: 'PVC-DWV-3IN', qty: 198, uom: 'LF' },
      { sku: 'PVC-DWV-4IN', qty: 132, uom: 'LF' },
      { sku: 'WC-KOHLER-K3989', qty: 4, uom: 'EA' },
      { sku: 'LAV-AS-STUDIO', qty: 4, uom: 'EA' },
    ];

    for (const material of materials) {
      await prisma.material.create({
        data: {
          jobId: job.id,
          sku: material.sku,
          qty: material.qty,
          uom: material.uom,
        },
      });
    }

    return {
      success: true,
      message: 'Mock job seeded successfully',
      jobId: job.id,
      filename: file.filename,
      stats: {
        rooms: rooms.length,
        features: features.length,
        materials: materials.length,
        totalSF: rooms.reduce((s, r) => s + r.area, 0),
      },
    };
  }
}

