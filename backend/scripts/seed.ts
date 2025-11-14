import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const sampleRuleSet = {
  version: 1,
  units: {
    linear: 'ft',
    area: 'ft2',
    volume: 'ft3',
  },
  vars: {
    height_ft: 10,
    waste_pct: 0.07,
  },
  rules: [
    // Architectural Rules
    {
      when: { feature: 'wall', partitionType: 'PT-1' },
      materials: [
        {
          sku: 'STUD-362-20GA',
          qty: 'length * 0.75', // studs @16" o.c.
          uom: 'ea',
          description: '3-5/8" Metal Stud, 20 GA',
        },
        {
          sku: 'GWB-58X-TypeX',
          qty: 'length * height_ft * 2 / 32', // 4x8 sheets both sides
          uom: 'ea',
          description: '5/8" Gypsum Board, Type X',
        },
        {
          sku: 'INSUL-ACOUSTIC',
          qty: 'length * height_ft / 16', // batts per 16 sf
          uom: 'ea',
          description: 'Acoustic Insulation Batt',
        },
      ],
    },
    {
      when: { feature: 'wall', partitionType: 'PT-2' },
      materials: [
        {
          sku: 'STUD-600-20GA',
          qty: 'length * 0.75',
          uom: 'ea',
          description: '6" Metal Stud, 20 GA',
        },
        {
          sku: 'GWB-58X-TypeX',
          qty: 'length * height_ft * 2 / 32',
          uom: 'ea',
          description: '5/8" Gypsum Board, Type X',
        },
      ],
    },
    
    // Plumbing Rules
    {
      when: { feature: 'pipe', service: 'CW', diameterIn: 1 },
      materials: [
        {
          sku: 'PVC-1IN',
          qty: 'length * (1 + waste_pct)',
          uom: 'ft',
          description: '1" PVC Pipe, Schedule 40',
        },
        {
          sku: 'COUPLING-1IN',
          qty: 'length / 10', // coupling every 10 feet
          uom: 'ea',
          description: '1" PVC Coupling',
        },
      ],
    },
    {
      when: { feature: 'pipe', service: 'HW', diameterIn: 0.75 },
      materials: [
        {
          sku: 'COPPER-3/4IN',
          qty: 'length * (1 + waste_pct)',
          uom: 'ft',
          description: '3/4" Copper Pipe, Type L',
        },
        {
          sku: 'ELBOW-3/4IN',
          qty: 'length / 20', // elbow every 20 feet
          uom: 'ea',
          description: '3/4" Copper 90° Elbow',
        },
      ],
    },
    
    // HVAC Rules
    {
      when: { feature: 'duct', size: '12x10' },
      materials: [
        {
          sku: 'DUCT-12X10',
          qty: 'length * (1 + waste_pct)',
          uom: 'ft',
          description: '12" x 10" Galvanized Duct',
        },
        {
          sku: 'REGISTER-12X10',
          qty: 'length / 50', // register every 50 feet
          uom: 'ea',
          description: '12" x 10" Supply Register',
        },
      ],
    },
    
    // Electrical Rules
    {
      when: { feature: 'fixture', fixtureType: 'FD2' },
      materials: [
        {
          sku: 'LED-2X4-40W',
          qty: 'count',
          uom: 'ea',
          description: '2x4 LED Troffer, 40W',
        },
        {
          sku: 'SWITCH-SINGLE',
          qty: 'count / 4', // one switch per 4 fixtures
          uom: 'ea',
          description: 'Single Pole Switch, 15A',
        },
      ],
    },
  ],
};

async function main() {
  console.log('Seeding database...');

  // Create or update Standard Commercial Rules
  const ruleSet = await prisma.materialsRuleSet.upsert({
    where: {
      name_version: {
        name: 'Standard Commercial Rules',
        version: '1.0',
      },
    },
    update: {
      rules: sampleRuleSet, // You can choose to omit or keep this if you don’t want to overwrite
    },
    create: {
      name: 'Standard Commercial Rules',
      version: '1.0',
      rules: sampleRuleSet,
    },
  });

  console.log(`Created or updated rule set: ${ruleSet.id}`);

  // Create or update Residential Rules
  const residentialRuleSet = await prisma.materialsRuleSet.upsert({
    where: {
      name_version: {
        name: 'Residential Rules',
        version: '1.0',
      },
    },
    update: {
      rules: {
        ...sampleRuleSet,
        vars: {
          height_ft: 9, // Lower ceiling height for residential
          waste_pct: 0.05,
        },
      },
    },
    create: {
      name: 'Residential Rules',
      version: '1.0',
      rules: {
        ...sampleRuleSet,
        vars: {
          height_ft: 9,
          waste_pct: 0.05,
        },
      },
    },
  });

  console.log(`Created or updated residential rule set: ${residentialRuleSet.id}`);

  console.log('Database seeded successfully!');
}


main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
