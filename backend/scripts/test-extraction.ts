import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const FILE_ID = 'cmif97m4j0000kunyt5il3pfp';

async function main() {
  console.log('📋 Creating new test job with improved wall prompt...');
  
  const job = await prisma.job.create({
    data: {
      fileId: FILE_ID,
      disciplines: ['A', 'P', 'M'],
      targets: ['rooms', 'walls', 'pipes', 'ducts', 'fixtures'],
      status: 'QUEUED',
      progress: 0,
    },
  });
  
  console.log(`✅ Created job: ${job.id}`);
  console.log('   Status: QUEUED');
  console.log('\n💡 The backend should auto-process this job.');
  console.log(`   Monitor with: curl http://localhost:10000/v1/jobs/${job.id}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
