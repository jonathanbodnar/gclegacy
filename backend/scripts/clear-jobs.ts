/**
 * Script to clear all queued/processing jobs from the database
 * Run with: npx ts-node scripts/clear-jobs.ts
 */

import { PrismaClient } from '@prisma/client';

async function clearJobs() {
  const prisma = new PrismaClient();
  
  try {
    console.log('🧹 Clearing all queued and processing jobs...\n');
    
    // Find jobs to clear
    const jobsToCancel = await prisma.job.findMany({
      where: {
        status: { in: ['QUEUED', 'PROCESSING'] }
      },
      select: { id: true, status: true, createdAt: true }
    });
    
    console.log(`Found ${jobsToCancel.length} jobs to cancel:`);
    jobsToCancel.forEach(j => {
      console.log(`  - ${j.id} (${j.status}, created ${j.createdAt.toISOString()})`);
    });
    
    if (jobsToCancel.length === 0) {
      console.log('\n✅ No jobs to clear!');
      return;
    }
    
    // Option 1: Cancel jobs (keeps history)
    const cancelled = await prisma.job.updateMany({
      where: {
        status: { in: ['QUEUED', 'PROCESSING'] }
      },
      data: {
        status: 'CANCELLED',
        error: 'Manually cancelled via clear-jobs script'
      }
    });
    
    console.log(`\n✅ Cancelled ${cancelled.count} jobs`);
    
    // Option 2: Delete jobs completely (uncomment if you want full deletion)
    // const deleted = await prisma.job.deleteMany({
    //   where: {
    //     status: { in: ['QUEUED', 'PROCESSING'] }
    //   }
    // });
    // console.log(`\n✅ Deleted ${deleted.count} jobs`);
    
  } catch (error) {
    console.error('❌ Error clearing jobs:', error);
  } finally {
    await prisma.$disconnect();
  }
}

clearJobs();
