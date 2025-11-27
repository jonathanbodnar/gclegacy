export const standardCommercialRuleSet = {
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
    {
      when: { feature: 'wall', partitionType: 'Interior' },
      materials: [
        {
          sku: 'STUD-362-20GA',
          qty: 'length * 0.75',
          uom: 'ea',
          description: '3-5/8" Interior Stud, 20 GA',
        },
        {
          sku: 'GWB-58X-TypeX',
          qty: 'length * height_ft * 2 / 32',
          uom: 'ea',
          description: '5/8" Gypsum Board, Type X (both sides)',
        },
        {
          sku: 'INSUL-ACOUSTIC',
          qty: 'length * height_ft / 16',
          uom: 'ea',
          description: 'Acoustic Insulation Batt',
        },
      ],
    },
    {
      when: { feature: 'wall', partitionType: 'Exterior' },
      materials: [
        {
          sku: 'STUD-600-18GA',
          qty: 'length * 0.6',
          uom: 'ea',
          description: '6" Exterior Stud, 18 GA',
        },
        {
          sku: 'SHEATH-OSB-716',
          qty: 'length * height_ft / 32',
          uom: 'ea',
          description: '7/16" OSB Sheathing',
        },
        {
          sku: 'AIR-BARRIER',
          qty: 'length * height_ft',
          uom: 'ft2',
          description: 'Exterior Air/Vapor Barrier',
        },
      ],
    },
    {
      when: { feature: 'pipe', service: 'Water' },
      materials: [
        {
          sku: 'PVC-2IN',
          qty: 'length * (1 + waste_pct)',
          uom: 'ft',
          description: '2" Domestic Water Pipe',
        },
        {
          sku: 'PIPE-HANGER',
          qty: 'length / 8',
          uom: 'ea',
          description: 'Pipe Hangers & Supports',
        },
      ],
    },
    {
      when: { feature: 'duct', service: 'HVAC' },
      materials: [
        {
          sku: 'DUCT-12X12',
          qty: 'length * (1 + waste_pct)',
          uom: 'ft',
          description: '12" x 12" Galvanized Duct',
        },
        {
          sku: 'REGISTER-12X12',
          qty: 'length / 40',
          uom: 'ea',
          description: '12" x 12" Supply Register',
        },
      ],
    },
    {
      when: { feature: 'fixture', fixtureType: 'Sink' },
      materials: [
        {
          sku: 'PLBG-SINK-PKG',
          qty: 'count',
          uom: 'ea',
          description: 'Sink Rough-in Package',
        },
        {
          sku: 'PLBG-TRAP',
          qty: 'count',
          uom: 'ea',
          description: '1-1/2" P-Trap Assembly',
        },
      ],
    },
    {
      when: { feature: 'fixture', fixtureType: 'Toilet' },
      materials: [
        {
          sku: 'PLBG-TOILET',
          qty: 'count',
          uom: 'ea',
          description: 'Floor Mounted Water Closet',
        },
        {
          sku: 'PLBG-CARRIER',
          qty: 'count',
          uom: 'ea',
          description: 'Toilet Carrier/Flange',
        },
      ],
    },
  ],
} as const;

export const residentialRuleSet = {
  ...standardCommercialRuleSet,
  vars: {
    height_ft: 9,
    waste_pct: 0.05,
  },
} as const;


