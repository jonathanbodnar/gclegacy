import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const MOCK_JOB_ID = 'mock-test-job-001';
const MOCK_FILE_CHECKSUM = 'mock-test-job-2024';

async function resetMockJob() {
  console.log('🧹 Cleaning up existing mock job data...');
  
  // Delete in reverse order of dependencies
  await prisma.material.deleteMany({ where: { jobId: MOCK_JOB_ID } });
  await prisma.feature.deleteMany({ where: { jobId: MOCK_JOB_ID } });
  await prisma.sheet.deleteMany({ where: { jobId: MOCK_JOB_ID } });
  await prisma.job.deleteMany({ where: { id: MOCK_JOB_ID } });
  await prisma.file.deleteMany({ where: { checksum: MOCK_FILE_CHECKSUM } });
  
  console.log('✅ Cleanup complete');
}

async function seedMockJob() {
  console.log('🌱 Seeding mock job for testing GC Interface workflow...\n');

  // Reset first to ensure clean slate
  await resetMockJob();

  // 1. Create a mock PDF file
  const file = await prisma.file.create({
    data: {
      filename: 'Mock Commercial Building - MEP Plans.pdf',
      mime: 'application/pdf',
      pages: 15,
      checksum: MOCK_FILE_CHECKSUM,
      size: BigInt(5242880), // 5MB
      tags: ['test', 'commercial', 'mock', 'demo'],
      storageKey: 'mock/commercial-building-2024.pdf',
      storageUrl: 'https://example.com/mock-commercial.pdf',
    },
  });
  console.log('📄 Created file:', file.filename);

  // 2. Create a COMPLETED job
  const job = await prisma.job.create({
    data: {
      id: MOCK_JOB_ID,
      fileId: file.id,
      status: 'COMPLETED',
      disciplines: ['A', 'P', 'M', 'E'],
      targets: ['rooms', 'walls', 'doors', 'windows', 'pipes', 'ducts', 'fixtures'],
      options: {
        bimPreferred: false,
        inferScale: true,
      },
      startedAt: new Date('2024-11-15T10:00:00Z'),
      finishedAt: new Date('2024-11-15T10:15:00Z'),
      progress: 100,
    },
  });
  console.log('✅ Created job:', job.id);

  // 3. Create realistic features

  // ROOMS (5 rooms)
  console.log('\n📐 Creating features...');
  const roomData = [
    { name: 'Sales Floor', area: 2500, usage: 'Retail' },
    { name: 'Back of House', area: 800, usage: 'Storage' },
    { name: 'Office', area: 300, usage: 'Office' },
    { name: 'Restroom 1', area: 120, usage: 'Restroom' },
    { name: 'Restroom 2', area: 120, usage: 'Restroom' },
  ];

  for (const room of roomData) {
    await prisma.feature.create({
      data: {
        jobId: job.id,
        type: 'ROOM',
        area: room.area,
        count: 1,
        props: {
          name: room.name,
          usage: room.usage,
          ceilingHeight: 10,
        },
      },
    });
  }
  console.log(`  ✓ ${roomData.length} rooms (${roomData.reduce((s, r) => s + r.area, 0)} SF)`);

  // WALLS
  const wallData = [
    { length: 180, height: 10, type: 'Drywall', thickness: 5.5 },
    { length: 90, height: 10, type: 'Drywall', thickness: 3.625 },
    { length: 60, height: 10, type: 'CMU', thickness: 8 },
    { length: 120, height: 10, type: 'Drywall', thickness: 5.5 },
  ];

  for (const wall of wallData) {
    await prisma.feature.create({
      data: {
        jobId: job.id,
        type: 'WALL',
        length: wall.length,
        area: wall.length * wall.height,
        props: {
          height: wall.height,
          wallType: wall.type,
          thickness: wall.thickness,
          partitionType: wall.type === 'Drywall' ? 'PT-1' : 'EW-1',
        },
      },
    });
  }
  console.log(`  ✓ ${wallData.length} walls (${wallData.reduce((s, w) => s + w.length, 0)} LF)`);

  // DOORS
  const doorData = [
    { width: 3, height: 7, type: 'Single', material: 'Hollow Metal' },
    { width: 6, height: 7, type: 'Double', material: 'Hollow Metal' },
    { width: 3, height: 7, type: 'Single', material: 'Wood' },
    { width: 3, height: 7, type: 'Single', material: 'Hollow Metal' },
    { width: 2.5, height: 7, type: 'Single', material: 'Wood' },
  ];

  for (const door of doorData) {
    await prisma.feature.create({
      data: {
        jobId: job.id,
        type: 'OPENING' as any,
        area: door.width * door.height,
        count: 1,
        props: {
          openingType: 'DOOR',
          width: door.width,
          height: door.height,
          doorType: door.type,
          material: door.material,
        },
      },
    });
  }
  console.log(`  ✓ ${doorData.length} doors`);

  // WINDOWS
  const windowData = [
    { width: 4, height: 5, count: 6, type: 'Fixed' },
    { width: 3, height: 4, count: 4, type: 'Operable' },
    { width: 2, height: 3, count: 2, type: 'Fixed' },
  ];

  for (const window of windowData) {
    await prisma.feature.create({
      data: {
        jobId: job.id,
        type: 'OPENING' as any,
        area: window.width * window.height,
        count: window.count,
        props: {
          openingType: 'WINDOW',
          width: window.width,
          height: window.height,
          windowType: window.type,
          glazing: 'Double',
          frame: 'Aluminum',
        },
      },
    });
  }
  const totalWindows = windowData.reduce((s, w) => s + w.count, 0);
  console.log(`  ✓ ${totalWindows} windows`);

  // PIPES (Cold Water, Hot Water, Sanitary, Vent)
  const pipeData = [
    { length: 250, diameter: 1, service: 'CW', material: 'Copper Type L', vertical: false },
    { length: 250, diameter: 1, service: 'HW', material: 'Copper Type L', vertical: false },
    { length: 180, diameter: 3, service: 'Sanitary', material: 'PVC DWV', vertical: true, verticalRun: 30 },
    { length: 120, diameter: 4, service: 'Sanitary', material: 'PVC DWV', vertical: true, verticalRun: 30 },
    { length: 80, diameter: 2, service: 'Vent', material: 'PVC DWV', vertical: true, verticalRun: 25 },
    { length: 60, diameter: 0.75, service: 'CW', material: 'Copper Type L', vertical: false },
  ];

  for (const pipe of pipeData) {
    await prisma.feature.create({
      data: {
        jobId: job.id,
        type: 'PIPE',
        length: pipe.length,
        props: {
          diameterIn: pipe.diameter,
          service: pipe.service,
          material: pipe.material,
          vertical: pipe.vertical,
          verticalRun: pipe.verticalRun || 0,
          fittings: {
            elbows90: Math.floor(pipe.length / 30), // Estimate elbows
            tees: Math.floor(pipe.length / 50), // Estimate tees
            couplings: Math.floor(pipe.length / 20),
          },
        },
      },
    });
  }
  const totalPipeLength = pipeData.reduce((s, p) => s + p.length, 0);
  console.log(`  ✓ ${pipeData.length} pipe runs (${totalPipeLength} LF)`);

  // DUCTS
  const ductData = [
    { length: 180, width: 12, height: 8, ductType: 'Supply' },
    { length: 120, width: 10, height: 6, ductType: 'Supply' },
    { length: 90, width: 8, height: 6, ductType: 'Return' },
    { length: 60, width: 6, height: 6, ductType: 'Return' },
  ];

  for (const duct of ductData) {
    await prisma.feature.create({
      data: {
        jobId: job.id,
        type: 'DUCT',
        length: duct.length,
        area: ((duct.width + duct.height) * 2 * duct.length) / 144, // SF of duct
        props: {
          width: duct.width,
          height: duct.height,
          ductType: duct.ductType,
          material: 'Galvanized Steel',
        },
      },
    });
  }
  console.log(`  ✓ ${ductData.length} duct runs`);

  // FIXTURES
  const fixtureData = [
    { type: 'Water Closet', count: 4, manufacturer: 'Kohler', model: 'K-3989', trade: 'P' },
    { type: 'Lavatory', count: 4, manufacturer: 'American Standard', model: 'Studio', trade: 'P' },
    { type: 'Urinal', count: 2, manufacturer: 'Sloan', model: 'WEUS-1000', trade: 'P' },
    { type: 'Mop Sink', count: 1, manufacturer: 'Elkay', model: 'PSDKR33229', trade: 'P' },
    { type: 'Water Heater', count: 1, manufacturer: 'Rheem', model: 'RTGH-95DVLN', trade: 'P' },
    { type: 'RTU', count: 2, manufacturer: 'Carrier', model: '48VL-A06A', trade: 'M' },
    { type: 'VAV Box', count: 8, manufacturer: 'Trane', model: 'CVHE', trade: 'M' },
    { type: 'Electrical Panel', count: 2, manufacturer: 'Square D', model: 'QO', trade: 'E' },
  ];

  for (const fixture of fixtureData) {
    await prisma.feature.create({
      data: {
        jobId: job.id,
        type: 'FIXTURE',
        count: fixture.count,
        props: {
          fixtureType: fixture.type,
          manufacturer: fixture.manufacturer,
          model: fixture.model,
          trade: fixture.trade,
        },
      },
    });
  }
  const totalFixtures = fixtureData.reduce((s, f) => s + f.count, 0);
  console.log(`  ✓ ${totalFixtures} fixtures`);

  // 4. Create materials (what would be in BOM)
  console.log('\n💎 Creating materials...');
  const materialData = [
    { sku: 'VCT-12X12-STANDARD', qty: 4224, uom: 'SF' }, // 3840 SF * 1.1 waste
    { sku: 'PAINT-INT-EGGSHELL', qty: 4410, uom: 'SF' }, // Walls * 1.05
    { sku: 'ACT-2X2-STANDARD', qty: 4147, uom: 'SF' }, // 3840 * 1.08
    { sku: 'COPPER-L-1IN', qty: 583, uom: 'LF' }, // 530 LF * 1.1
    { sku: 'COPPER-L-0.75IN', qty: 66, uom: 'LF' },
    { sku: 'PVC-DWV-3IN', qty: 198, uom: 'LF' },
    { sku: 'PVC-DWV-4IN', qty: 132, uom: 'LF' },
    { sku: 'PVC-DWV-2IN', qty: 88, uom: 'LF' },
    { sku: 'ELBOW-90-1IN-COPPER', qty: 48, uom: 'EA' },
    { sku: 'TEE-1IN-COPPER', qty: 22, uom: 'EA' },
    { sku: 'COUPLING-1IN-COPPER', qty: 30, uom: 'EA' },
    { sku: 'WC-KOHLER-K3989', qty: 4, uom: 'EA' },
    { sku: 'LAV-AS-STUDIO', qty: 4, uom: 'EA' },
    { sku: 'URINAL-SLOAN-WEUS1000', qty: 2, uom: 'EA' },
    { sku: 'SINK-ELKAY-PSDKR33229', qty: 1, uom: 'EA' },
    { sku: 'WH-RHEEM-RTGH95', qty: 1, uom: 'EA' },
    { sku: 'RTU-CARRIER-48VL', qty: 2, uom: 'EA' },
    { sku: 'VAV-TRANE-CVHE', qty: 8, uom: 'EA' },
    { sku: 'PANEL-SQUARED-QO', qty: 2, uom: 'EA' },
    { sku: 'DUCT-GALV-12X8', qty: 180, uom: 'LF' },
    { sku: 'DUCT-GALV-10X6', qty: 120, uom: 'LF' },
  ];

  for (const material of materialData) {
    await prisma.material.create({
      data: {
        jobId: job.id,
        sku: material.sku,
        qty: material.qty,
        uom: material.uom,
        sources: [],
      },
    });
  }
  console.log(`  ✓ ${materialData.length} materials`);

  // Summary
  const totalArea = roomData.reduce((sum, r) => sum + r.area, 0);
  
  console.log('\n' + '='.repeat(60));
  console.log('🎉 Mock job seeded successfully!\n');
  console.log(`📋 Job ID: ${job.id}`);
  console.log(`📁 File: ${file.filename}`);
  console.log(`📊 Total Area: ${totalArea.toLocaleString()} SF`);
  console.log(`📐 Features:`);
  console.log(`   • ${roomData.length} Rooms`);
  console.log(`   • ${wallData.length} Walls`);
  console.log(`   • ${doorData.length} Doors`);
  console.log(`   • ${totalWindows} Windows`);
  console.log(`   • ${pipeData.length} Pipe Runs (${totalPipeLength} LF)`);
  console.log(`   • ${ductData.length} Duct Runs`);
  console.log(`   • ${totalFixtures} Fixtures`);
  console.log(`💎 Materials: ${materialData.length} items`);
  console.log('='.repeat(60));
  console.log('\n✨ You can now import this job in GC Interface!');
  console.log(`🔗 Import URL: https://gcinterface-development.up.railway.app/projects`);
  console.log(`\n💡 To reset and reseed: npm run seed:mock-job\n`);
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  
  if (args.includes('--reset-only')) {
    await resetMockJob();
    console.log('✅ Mock job data cleared');
  } else {
    await seedMockJob();
  }
}

main()
  .catch((e) => {
    console.error('❌ Error seeding mock job:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

