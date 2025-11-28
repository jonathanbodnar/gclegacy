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
    // Architectural
    {
      when: { feature: 'wall', partitionType: 'PT-1' },
      materials: [
        {
          sku: 'STUD-362-20GA',
          qty: 'length * 0.75',
          uom: 'ea',
          description: '3-5/8" Metal Stud, 20 GA',
        },
        {
          sku: 'GWB-58X-TypeX',
          qty: 'length * height_ft * 2 / 32',
          uom: 'ea',
          description: '5/8" Gypsum Board, Type X',
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
    // Plumbing
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
          qty: 'length / 10',
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
          qty: 'length / 20',
          uom: 'ea',
          description: '3/4" Copper 90° Elbow',
        },
      ],
    },
    // HVAC
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
          qty: 'length / 50',
          uom: 'ea',
          description: '12" x 10" Supply Register',
        },
      ],
    },
    // Electrical / Fixtures
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
          qty: 'count / 4',
          uom: 'ea',
          description: 'Single Pole Switch, 15A',
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

