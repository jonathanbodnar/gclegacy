import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface CostIntelligenceInput {
  jobId: string;
  features: any[];
  scopeDiagnosis?: any;
  materialsRuleSetId?: string;
}

export interface TradeCostSummary {
  trade: string;
  tradeLabel: string;
  featureTypes: string[];
  quantity: number;
  quantityUnit: string;
  materialCost: number;
  laborCost: number;
  equipmentCost: number;
  markupPct: number;
  markupValue: number;
  totalCost: number;
  drivers?: string[];
}

export interface CostIntelligenceResult {
  baseCurrency: string;
  settings: {
    materialEscalationPct: number;
    laborEscalationPct: number;
    adminMarkup: Record<string, number>;
  };
  trades: TradeCostSummary[];
  totals: {
    materialCost: number;
    laborCost: number;
    equipmentCost: number;
    markup: number;
    grandTotal: number;
  };
  confidence: number;
  notes?: string[];
}

const FEATURE_COST_LIBRARY: Record<
  string,
  {
    trade: string;
    unit: 'lf' | 'sf' | 'ea';
    materialPerUnit: number;
    laborPerUnit: number;
    equipmentPerUnit: number;
    drivers?: string[];
  }
> = {
  ROOM: {
    trade: 'A',
    unit: 'sf',
    materialPerUnit: 6.5,
    laborPerUnit: 4.5,
    equipmentPerUnit: 0.75,
    drivers: ['Interior fit-out'],
  },
  WALL: {
    trade: 'A',
    unit: 'lf',
    materialPerUnit: 18,
    laborPerUnit: 12,
    equipmentPerUnit: 1.5,
    drivers: ['Stud + drywall partitions'],
  },
  OPENING: {
    trade: 'A',
    unit: 'ea',
    materialPerUnit: 850,
    laborPerUnit: 220,
    equipmentPerUnit: 45,
    drivers: ['Door / window packages'],
  },
  PIPE: {
    trade: 'P',
    unit: 'lf',
    materialPerUnit: 22,
    laborPerUnit: 16,
    equipmentPerUnit: 2,
    drivers: ['CW / HW / SAN piping'],
  },
  FIXTURE: {
    trade: 'P',
    unit: 'ea',
    materialPerUnit: 780,
    laborPerUnit: 180,
    equipmentPerUnit: 35,
  },
  DUCT: {
    trade: 'M',
    unit: 'lf',
    materialPerUnit: 28,
    laborPerUnit: 20,
    equipmentPerUnit: 4,
    drivers: ['Supply / return ductwork'],
  },
  LEVEL: {
    trade: 'A',
    unit: 'ea',
    materialPerUnit: 250,
    laborPerUnit: 140,
    equipmentPerUnit: 10,
  },
  ELEVATION: {
    trade: 'A',
    unit: 'ea',
    materialPerUnit: 420,
    laborPerUnit: 180,
    equipmentPerUnit: 15,
  },
  SECTION: {
    trade: 'S',
    unit: 'ea',
    materialPerUnit: 520,
    laborPerUnit: 200,
    equipmentPerUnit: 20,
  },
  RISER: {
    trade: 'P',
    unit: 'ea',
    materialPerUnit: 980,
    laborPerUnit: 320,
    equipmentPerUnit: 55,
  },
};

const TRADE_LABELS: Record<string, string> = {
  A: 'Architectural / Interiors',
  P: 'Plumbing',
  M: 'Mechanical / HVAC',
  E: 'Electrical',
  S: 'Structural',
  V: 'Vertical Transport',
};

@Injectable()
export class CostIntelligenceService {
  private readonly logger = new Logger(CostIntelligenceService.name);
  private readonly markupByTrade: Record<string, number>;
  private readonly escalationMaterialPct: number;
  private readonly escalationLaborPct: number;

  constructor(private readonly configService: ConfigService) {
    this.markupByTrade = this.loadMarkupSettings();
    this.escalationMaterialPct =
      this.configService.get<number>('MATERIAL_ESCALATION_PCT') ?? 0.03;
    this.escalationLaborPct =
      this.configService.get<number>('LABOR_ESCALATION_PCT') ?? 0.025;
  }

  generateCostSnapshot(
    input: CostIntelligenceInput,
  ): CostIntelligenceResult {
    const tradeBuckets = new Map<
      string,
      TradeCostSummary & { featureSet: Set<string> }
    >();
    const notes: string[] = [];

    for (const feature of input.features) {
      const definition = FEATURE_COST_LIBRARY[feature.type];
      if (!definition) continue;

      const quantity = this.getFeatureQuantity(feature, definition.unit);
      if (!quantity) continue;

      const tradeKey = definition.trade;
      if (!tradeBuckets.has(tradeKey)) {
        tradeBuckets.set(tradeKey, {
          trade: tradeKey,
          tradeLabel: TRADE_LABELS[tradeKey] || tradeKey,
          featureTypes: [],
          featureSet: new Set<string>(),
          quantity: 0,
          quantityUnit: definition.unit,
          materialCost: 0,
          laborCost: 0,
          equipmentCost: 0,
          markupPct: this.markupByTrade[tradeKey] ?? 0.1,
          markupValue: 0,
          totalCost: 0,
          drivers: [],
        });
      }

      const bucket = tradeBuckets.get(tradeKey)!;
      bucket.quantity += quantity;
      bucket.materialCost += quantity * definition.materialPerUnit;
      bucket.laborCost += quantity * definition.laborPerUnit;
      bucket.equipmentCost += quantity * definition.equipmentPerUnit;
      bucket.featureSet.add(feature.type);

      if (definition.drivers) {
        bucket.drivers = Array.from(
          new Set([...(bucket.drivers || []), ...definition.drivers]),
        );
      }
    }

    const trades: TradeCostSummary[] = Array.from(tradeBuckets.values()).map(
      (bucket) => {
        const escalatedMaterial =
          bucket.materialCost * (1 + this.escalationMaterialPct);
        const escalatedLabor =
          bucket.laborCost * (1 + this.escalationLaborPct);
        const subtotal =
          escalatedMaterial + escalatedLabor + bucket.equipmentCost;
        const markupValue = subtotal * bucket.markupPct;
        return {
          ...bucket,
          quantity: Number(bucket.quantity.toFixed(2)),
          materialCost: Number(escalatedMaterial.toFixed(2)),
          laborCost: Number(escalatedLabor.toFixed(2)),
          equipmentCost: Number(bucket.equipmentCost.toFixed(2)),
          markupValue: Number(markupValue.toFixed(2)),
          totalCost: Number((subtotal + markupValue).toFixed(2)),
          featureTypes: Array.from(bucket.featureSet),
        };
      },
    );

    const totals = trades.reduce(
      (acc, trade) => {
        acc.materialCost += trade.materialCost;
        acc.laborCost += trade.laborCost;
        acc.equipmentCost += trade.equipmentCost;
        acc.markup += trade.markupValue;
        return acc;
      },
      {
        materialCost: 0,
        laborCost: 0,
        equipmentCost: 0,
        markup: 0,
      },
    );
    totals.materialCost = Number(totals.materialCost.toFixed(2));
    totals.laborCost = Number(totals.laborCost.toFixed(2));
    totals.equipmentCost = Number(totals.equipmentCost.toFixed(2));
    totals.markup = Number(totals.markup.toFixed(2));
    const grandTotal =
      totals.materialCost +
      totals.laborCost +
      totals.equipmentCost +
      totals.markup;

    if (trades.length === 0) {
      notes.push(
        'No cost-bearing features detected. Ensure targets include measurable systems.',
      );
    }
    if (input.scopeDiagnosis?.verticalSystems?.riserCount === 0) {
      notes.push(
        'Vertical systems missing; add contingency for potential risers/elevators.',
      );
    }
    if (input.materialsRuleSetId) {
      notes.push(
        `Materials rule set ${input.materialsRuleSetId} applied before costing.`,
      );
    }

    return {
      baseCurrency: 'USD',
      settings: {
        materialEscalationPct: this.escalationMaterialPct,
        laborEscalationPct: this.escalationLaborPct,
        adminMarkup: this.markupByTrade,
      },
      trades,
      totals: {
        ...totals,
        grandTotal: Number(grandTotal.toFixed(2)),
      },
      confidence: trades.length ? 0.62 : 0.3,
      notes,
    };
  }

  private loadMarkupSettings(): Record<string, number> {
    const defaults: Record<string, number> = {
      A: 0.12,
      P: 0.15,
      M: 0.17,
      E: 0.14,
      S: 0.1,
    };

    const overrideJson = this.configService.get<string>(
      'ADMIN_MARKUPS_JSON',
    );
    if (overrideJson) {
      try {
        const parsed = JSON.parse(overrideJson);
        Object.assign(defaults, parsed);
      } catch (error) {
        this.logger.warn(
          `Failed to parse ADMIN_MARKUPS_JSON: ${error.message}`,
        );
      }
    }

    const envOverrides: Record<string, string> = {
      A: this.configService.get('ADMIN_MARKUP_A'),
      P: this.configService.get('ADMIN_MARKUP_P'),
      M: this.configService.get('ADMIN_MARKUP_M'),
      E: this.configService.get('ADMIN_MARKUP_E'),
      S: this.configService.get('ADMIN_MARKUP_S'),
    };

    Object.entries(envOverrides).forEach(([trade, value]) => {
      if (!value) return;
      const pct = Number(value);
      if (!Number.isNaN(pct) && pct >= 0) {
        defaults[trade] = pct;
      }
    });

    return defaults;
  }

  private getFeatureQuantity(feature: any, unit: string): number | null {
    switch (unit) {
      case 'lf':
        return feature.length || null;
      case 'sf':
        return feature.area || null;
      case 'ea':
        return feature.count || 1;
      default:
        return null;
    }
  }
}
