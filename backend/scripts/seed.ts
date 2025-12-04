import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Comprehensive rule set that works with all extracted feature types
const sampleRuleSet = {
  version: 1,
  units: {
    linear: 'ft',
    area: 'ft2',
    volume: 'ft3',
  },
  vars: {
    wall_height: 9,
    perimeter_ratio: 0.4,
    waste_floor: 1.07,
    waste_paint: 1.15,
    waste_ceiling: 1.05,
  },
  rules: [
    // Room/Space Rules - generates flooring, paint, ceiling, base
    {
      when: { feature: 'room' },
      materials: [
        {
          sku: 'ARM-EXCELON-51910',
          qty: 'area * waste_floor',
          uom: 'SF',
          description: 'Armstrong Excelon VCT Flooring (12x12)',
        },
        {
          sku: 'SW-7006-PAINT',
          qty: 'area * perimeter_ratio * waste_paint',
          uom: 'SF',
          description: 'Sherwin Williams Extra White Interior Paint',
        },
        {
          sku: 'ARM-CIRRUS-ACT',
          qty: 'area * waste_ceiling',
          uom: 'SF',
          description: 'Armstrong Cirrus 2x2 ACT Ceiling Tiles',
        },
        {
          sku: 'RUBBER-BASE-4IN',
          qty: 'area * perimeter_ratio',
          uom: 'LF',
          description: '4-inch Rubber Base Molding',
        },
      ],
    },

    // Wall Rules - generates framing and drywall
    {
      when: { feature: 'wall' },
      materials: [
        {
          sku: 'STUD-362-20GA',
          qty: 'length * 0.75',
          uom: 'LF',
          description: 'Metal Studs 3-5/8" 20GA @ 16" OC',
        },
        {
          sku: 'GWB-58-TYPEX',
          qty: 'length * wall_height * 2 / 32',
          uom: 'SHT',
          description: '5/8" Type X Gypsum Board (4x8 sheets)',
        },
        {
          sku: 'JOINT-COMPOUND',
          qty: 'length * wall_height * 0.05',
          uom: 'GAL',
          description: 'Joint Compound',
        },
        {
          sku: 'DRYWALL-TAPE',
          qty: 'length * 1.1',
          uom: 'LF',
          description: 'Paper Drywall Tape',
        },
      ],
    },

    // Opening Rules (doors/windows)
    {
      when: { feature: 'opening' },
      materials: [
        {
          sku: 'DOOR-FRAME-HM',
          qty: 'count',
          uom: 'EA',
          description: 'Hollow Metal Door Frame 3-0 x 7-0',
        },
        {
          sku: 'DOOR-SOLID-SC',
          qty: 'count',
          uom: 'EA',
          description: 'Solid Core Wood Door',
        },
        {
          sku: 'HARDWARE-SET',
          qty: 'count',
          uom: 'SET',
          description: 'Door Hardware Set (hinges, lockset, closer)',
        },
      ],
    },

    // Pipe Rules
    {
      when: { feature: 'pipe' },
      materials: [
        {
          sku: 'PIPE-COPPER-L',
          qty: 'length',
          uom: 'LF',
          description: 'Copper Pipe Type L',
        },
        {
          sku: 'PIPE-FITTING',
          qty: 'length * 0.1',
          uom: 'EA',
          description: 'Copper Fittings (elbows, tees, couplings)',
        },
        {
          sku: 'PIPE-HANGER',
          qty: 'length / 4',
          uom: 'EA',
          description: 'Pipe Hangers @ 4ft OC',
        },
        {
          sku: 'PIPE-INSUL',
          qty: 'length',
          uom: 'LF',
          description: 'Pipe Insulation',
        },
      ],
    },

    // Duct Rules
    {
      when: { feature: 'duct' },
      materials: [
        {
          sku: 'DUCT-GALV-RECT',
          qty: 'length',
          uom: 'LF',
          description: 'Galvanized Rectangular Ductwork',
        },
        {
          sku: 'DUCT-FITTING',
          qty: 'length * 0.15',
          uom: 'EA',
          description: 'Duct Fittings (elbows, transitions)',
        },
        {
          sku: 'DUCT-HANGER',
          qty: 'length / 5',
          uom: 'EA',
          description: 'Duct Hangers @ 5ft OC',
        },
        {
          sku: 'DUCT-SEALANT',
          qty: 'length * 0.02',
          uom: 'TUBE',
          description: 'Duct Sealant',
        },
        {
          sku: 'DUCT-INSUL',
          qty: 'length * 2',
          uom: 'SF',
          description: 'Duct Insulation Wrap',
        },
      ],
    },

    // Fixture Rules (plumbing/electrical fixtures)
    {
      when: { feature: 'fixture' },
      materials: [
        {
          sku: 'FIXTURE-UNIT',
          qty: 'count',
          uom: 'EA',
          description: 'Plumbing/Electrical Fixture',
        },
        {
          sku: 'FIXTURE-CONN',
          qty: 'count * 2',
          uom: 'EA',
          description: 'Fixture Connections/Fittings',
        },
        {
          sku: 'FIXTURE-MOUNT',
          qty: 'count',
          uom: 'EA',
          description: 'Fixture Mounting Hardware',
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
