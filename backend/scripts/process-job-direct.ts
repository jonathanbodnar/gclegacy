/**
 * Direct job processing script - bypasses Redis queue
 * Useful for testing when Redis is not available
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { JobProcessor } from '../src/modules/jobs/job.processor';
import { PrismaService } from '../src/common/prisma/prisma.service';

async function main() {
  const jobId = process.argv[2];
  
  if (!jobId) {
    console.error('Usage: npx tsx scripts/process-job-direct.ts <jobId>');
    process.exit(1);
  }
  
  console.log(`\n🚀 Starting direct job processing for: ${jobId}\n`);
  
  // Bootstrap NestJS application
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  
  try {
    const prisma = app.get(PrismaService);
    const processor = app.get(JobProcessor);
    
    // Get job details
    const job = await prisma.job.findUnique({
      where: { id: jobId },
      include: { file: true },
    });
    
    if (!job) {
      console.error(`❌ Job not found: ${jobId}`);
      process.exit(1);
    }
    
    console.log(`📋 Job Details:`);
    console.log(`   File: ${job.file.filename}`);
    console.log(`   Disciplines: ${job.disciplines.join(', ')}`);
    console.log(`   Targets: ${job.targets.join(', ')}`);
    console.log(`   Status: ${job.status}`);
    console.log('');
    
    if (job.status === 'COMPLETED') {
      console.log('⚠️  Job already completed. Creating features count...');
      const features = await prisma.feature.groupBy({
        by: ['type'],
        where: { jobId },
        _count: true,
      });
      console.log('\nFeatures by type:');
      features.forEach(f => console.log(`   ${f.type}: ${f._count}`));
      process.exit(0);
    }
    
    // Process the job directly
    console.log('⏳ Processing job...\n');
    
    await processor.processJobData(
      {
        jobId: job.id,
        fileId: job.fileId,
        disciplines: job.disciplines,
        targets: job.targets,
        materialsRuleSetId: job.materialsRuleSetId || undefined,
        options: job.options as any,
      },
      async (percent) => {
        process.stdout.write(`\r   Progress: ${percent}%`);
      }
    );
    
    console.log('\n\n✅ Job processing complete!\n');
    
    // Show results
    const features = await prisma.feature.groupBy({
      by: ['type'],
      where: { jobId },
      _count: true,
    });
    
    console.log('📊 Features extracted:');
    features.forEach(f => console.log(`   ${f.type}: ${f._count}`));
    
    // Show rooms specifically
    const rooms = await prisma.feature.findMany({
      where: { jobId, type: 'ROOM' },
      select: { props: true, area: true, sheetId: true },
    });
    
    console.log(`\n🏠 Rooms (${rooms.length} total):`);
    rooms.forEach((r: any) => {
      console.log(`   - ${r.props?.name || 'Unknown'} (${r.area || 'no area'} SF)`);
    });
    
  } catch (error: any) {
    console.error('\n❌ Job processing failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await app.close();
  }
}

main();
