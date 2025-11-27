export interface MaterialRule {
  when: Record<string, unknown>;
  materials: Array<{
    sku: string;
    qty: string;
    uom?: string;
    description?: string;
  }>;
}

export interface RuleSet {
  version: number | string;
  units: {
    linear: string;
    area: string;
    volume?: string;
  };
  vars?: Record<string, unknown>;
  rules: MaterialRule[];
}


