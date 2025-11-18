import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface LaborModelingInput {
  jobId: string;
  features: any[];
  disciplines: string[];
  scopeDiagnosis?: any;
}

export interface CrewPlan {
  trade: string;
  crewType: string;
  crewSize: number;
  productivity: number; // units per hour
  units: string;
  quantity: number;
  hours: number;
  wageRate: number;
  laborCost: number;
  burdenPct: number;
  burdenCost: number;
}

export interface LaborModelingResult {
  crews: CrewPlan[];
  totals: {
    hours: number;
    laborCost: number;
    burdenCost: number;
  };
  recommendedShifts: number;
  peakCrewSize: number;
  notes?: string[];
}

const LABOR_LIBRARY: Record<
  string,
  {
    crewType: string;
    crewSize: number;
    productivity: number; // units per hour
    units: string;
    trade: string;
    wageRate: number;
    burdenPct: number;
  }
> = {
  WALL: {
    crewType: 'Carpenters + Drywall Finishers',
    crewSize: 4,
    productivity: 18,
    units: 'lf',
    trade: 'A',
    wageRate: 42,
    burdenPct: 0.38,
  },
  ROOM: {
    crewType: 'Interior Finish Crew',
    crewSize: 5,
    productivity: 250,
    units: 'sf',
    trade: 'A',
    wageRate: 40,
    burdenPct: 0.35,
  },
  PIPE: {
    crewType: 'Plumbers (Journeyman / Apprentice)',
    crewSize: 3,
    productivity: 25,
    units: 'lf',
    trade: 'P',
    wageRate: 48,
    burdenPct: 0.42,
  },
  FIXTURE: {
    crewType: 'Fixture Install Crew',
    crewSize: 2,
    productivity: 6,
    units: 'ea',
    trade: 'P',
    wageRate: 46,
    burdenPct: 0.4,
  },
  DUCT: {
    crewType: 'Sheet Metal Crew',
    crewSize: 4,
    productivity: 32,
    units: 'lf',
    trade: 'M',
    wageRate: 44,
    burdenPct: 0.39,
  },
  ELEVATION: {
    crewType: 'Finish Carpenters',
    crewSize: 3,
    productivity: 2,
    units: 'ea',
    trade: 'A',
    wageRate: 43,
    burdenPct: 0.36,
  },
  RISER: {
    crewType: 'Vertical Piping Crew',
    crewSize: 3,
    productivity: 1.2,
    units: 'ea',
    trade: 'P',
    wageRate: 49,
    burdenPct: 0.44,
  },
};

@Injectable()
export class LaborModelingService {
  private readonly defaultShifts: number;
  private readonly overrideProductivity: Record<string, number>;

  constructor(private readonly configService: ConfigService) {
    this.defaultShifts = this.configService.get<number>('LABOR_SHIFTS') ?? 1;
    this.overrideProductivity = this.loadProductivityOverrides();
  }

  buildLaborPlan(input: LaborModelingInput): LaborModelingResult {
    const crews: CrewPlan[] = [];
    const notes: string[] = [];

    for (const feature of input.features) {
      const plan = LABOR_LIBRARY[feature.type];
      if (!plan) continue;

      const quantity = this.getFeatureQuantity(feature, plan.units);
      if (!quantity) continue;

      const productivityOverride =
        this.overrideProductivity[feature.type] ?? plan.productivity;
      const hours = quantity / productivityOverride;
      const laborCost = hours * plan.wageRate;
      const burdenCost = laborCost * plan.burdenPct;

      crews.push({
        trade: plan.trade,
        crewType: plan.crewType,
        crewSize: plan.crewSize,
        productivity: productivityOverride,
        units: plan.units,
        quantity: Number(quantity.toFixed(2)),
        hours: Number(hours.toFixed(2)),
        wageRate: plan.wageRate,
        laborCost: Number(laborCost.toFixed(2)),
        burdenPct: plan.burdenPct,
        burdenCost: Number(burdenCost.toFixed(2)),
      });
    }

    if (crews.length === 0) {
      notes.push('No measurable features for labor modeling.');
    }

    const totals = crews.reduce(
      (acc, crew) => {
        acc.hours += crew.hours;
        acc.laborCost += crew.laborCost;
        acc.burdenCost += crew.burdenCost;
        return acc;
      },
      { hours: 0, laborCost: 0, burdenCost: 0 },
    );

    const peakCrewSize = crews.reduce(
      (max, crew) => Math.max(max, crew.crewSize),
      0,
    );

    if (input.scopeDiagnosis?.notes) {
      notes.push(...input.scopeDiagnosis.notes);
    }

    return {
      crews,
      totals: {
        hours: Number(totals.hours.toFixed(2)),
        laborCost: Number(totals.laborCost.toFixed(2)),
        burdenCost: Number(totals.burdenCost.toFixed(2)),
      },
      recommendedShifts: this.defaultShifts,
      peakCrewSize,
      notes: Array.from(new Set(notes)),
    };
  }

  private loadProductivityOverrides(): Record<string, number> {
    const overrides: Record<string, number> = {};
    const raw = this.configService.get<string>('LABOR_PRODUCTIVITY_JSON');
    if (!raw) return overrides;

    try {
      const parsed = JSON.parse(raw);
      Object.entries(parsed).forEach(([key, value]) => {
        const num = Number(value);
        if (!Number.isNaN(num) && num > 0) {
          overrides[key] = num;
        }
      });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('Failed to parse LABOR_PRODUCTIVITY_JSON:', error.message);
    }
    return overrides;
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
