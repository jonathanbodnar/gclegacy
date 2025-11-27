import yaml from 'js-yaml';
import { Types } from 'mongoose';
import { MaterialModel } from '../models/material.model';
import {
  MaterialsRuleSetDocument,
  MaterialsRuleSetModel,
} from '../models/materialsRuleSet.model';
import { FeatureDocument } from '../models/feature.model';
import { logger } from '../utils/logger';
import { HttpError } from '../utils/http-error';
import { MaterialRule, RuleSet } from '../types/rules';

export interface CreateRuleSetInput {
  name: string;
  version: string;
  rules: string;
}

export class RulesEngineService {
  async createRuleSet(input: CreateRuleSetInput): Promise<MaterialsRuleSetDocument> {
    const parsed = this.parseRulesPayload(input.rules);
    this.validateRuleSet(parsed);

    try {
      return await MaterialsRuleSetModel.create({
        name: input.name,
        version: input.version,
        rules: parsed,
      });
    } catch (error: any) {
      if (error.code === 11000) {
        throw new HttpError(409, 'Rule set with that name/version already exists');
      }
      throw error;
    }
  }

  async getRuleSetById(id: string): Promise<MaterialsRuleSetDocument> {
    const ruleSet = await MaterialsRuleSetModel.findById(id);
    if (!ruleSet) {
      throw new HttpError(404, 'Rule set not found');
    }
    return ruleSet;
  }

  async getDefaultRuleSet(): Promise<MaterialsRuleSetDocument | null> {
    return MaterialsRuleSetModel.findOne({
      name: 'Standard Commercial Rules',
      version: '1.0',
    });
  }

  async applyRules(
    jobId: string,
    ruleSetId: string,
    features: FeatureDocument[],
  ): Promise<number> {
    const ruleSet = await this.getRuleSetById(ruleSetId);
    const ruleSetPayload = ruleSet.rules;

    const materials = this.generateMaterialsFromFeatures(features, ruleSetPayload);

    await MaterialModel.deleteMany({ job: new Types.ObjectId(jobId) });
    if (materials.length > 0) {
      await MaterialModel.insertMany(
        materials.map((material) => ({
          ...material,
          job: new Types.ObjectId(jobId),
        })),
      );
    }

    logger.info(
      `Applied rule set ${ruleSetId} to job ${jobId}: ${materials.length} materials generated`,
    );

    return materials.length;
  }

  private parseRulesPayload(raw: string): RuleSet {
    try {
      // First try YAML
      const parsed = yaml.load(raw);
      return parsed as RuleSet;
    } catch (yamlError) {
      try {
        return JSON.parse(raw);
      } catch {
        throw new HttpError(400, 'Rules must be valid YAML or JSON');
      }
    }
  }

  private validateRuleSet(ruleSet: RuleSet): void {
    if (!ruleSet || typeof ruleSet !== 'object') {
      throw new HttpError(400, 'Rule set payload is invalid');
    }
    if (!ruleSet.version || !ruleSet.units || !Array.isArray(ruleSet.rules)) {
      throw new HttpError(400, 'Rule set must include version, units, and rules[]');
    }
    for (const rule of ruleSet.rules) {
      if (!rule.when || !rule.materials || !Array.isArray(rule.materials)) {
        throw new HttpError(400, 'Each rule must include "when" and materials[]');
      }
      rule.materials.forEach((material) => {
        if (!material.sku || !material.qty) {
          throw new HttpError(400, 'Each material entry requires sku and qty');
        }
      });
    }
  }

  private generateMaterialsFromFeatures(
    features: FeatureDocument[],
    ruleSet: RuleSet,
  ): GeneratedMaterial[] {
    const vars = ruleSet.vars || {};
    const rows: GeneratedMaterial[] = [];

    for (const feature of features) {
      const normalized = this.normalizeFeature(feature);
      const matchingRules = ruleSet.rules.filter((rule) =>
        this.featureMatches(rule.when, normalized),
      );

      matchingRules.forEach((rule) => {
        rule.materials.forEach((materialDef) => {
          const quantity = this.evaluateQuantity(materialDef.qty, normalized, vars);
          if (quantity > 0) {
            rows.push({
              sku: materialDef.sku,
              qty: quantity,
              uom: materialDef.uom || this.defaultUnit(materialDef.qty, ruleSet.units),
              description: materialDef.description,
              ruleId: this.ruleFingerprint(rule),
              pricing: this.lookupPricing(materialDef.sku, quantity),
              sources: {
                features: [feature._id.toString()],
                rule: materialDef.sku,
              },
            });
          }
        });
      });
    }

    return this.consolidateMaterials(rows);
  }

  private normalizeFeature(feature: FeatureDocument): NormalizedFeature {
    const props = (feature.props ?? {}) as Record<string, unknown>;
    return {
      id: feature._id.toString(),
      type: feature.type,
      length: feature.length ?? Number(props.length) ?? undefined,
      area: feature.area ?? Number(props.area) ?? undefined,
      count: feature.count ?? Number(props.count) ?? undefined,
      props,
    };
  }

  private featureMatches(
    condition: Record<string, unknown>,
    feature: NormalizedFeature,
  ): boolean {
    return Object.entries(condition).every(([key, expected]) => {
      if (key === 'feature') {
        return feature.type.toLowerCase() === String(expected).toLowerCase();
      }
      const value = this.deepGet(feature, key);
      return value === expected;
    });
  }

  private deepGet(obj: Record<string, unknown>, path: string): unknown {
    return path.split('.').reduce<unknown>((acc, part) => {
      if (acc && typeof acc === 'object' && part in (acc as Record<string, unknown>)) {
        return (acc as Record<string, unknown>)[part];
      }
      if (
        acc &&
        typeof acc === 'object' &&
        'props' in (acc as Record<string, unknown>) &&
        part in ((acc as Record<string, unknown>).props as Record<string, unknown>)
      ) {
        return ((acc as Record<string, unknown>).props as Record<string, unknown>)[part];
      }
      return undefined;
    }, obj);
  }

  private evaluateQuantity(
    expression: string,
    feature: NormalizedFeature,
    vars: Record<string, unknown>,
  ): number {
    const context: Record<string, number> = {};

    Object.entries(vars).forEach(([key, value]) => {
      const numeric = Number(value);
      if (!Number.isNaN(numeric)) {
        context[key] = numeric;
      }
    });

    (['length', 'area', 'count'] as const).forEach((key) => {
      const rawValue = feature[key];
      const numeric = Number(rawValue);
      if (!Number.isNaN(numeric)) {
        context[key] = numeric;
      }
    });

    Object.entries(feature.props).forEach(([key, value]) => {
      const numeric = Number(value);
      if (!Number.isNaN(numeric)) {
        context[key] = numeric;
      }
    });

    let expr = expression;
    Object.keys(context)
      .sort((a, b) => b.length - a.length)
      .forEach((key) => {
        const regex = new RegExp(`\\b${key}\\b`, 'g');
        expr = expr.replace(regex, context[key].toString());
      });

    if (!/^[0-9+\-*/().\s]+$/.test(expr)) {
      throw new Error(`Expression includes invalid characters: ${expression}`);
    }

    // eslint-disable-next-line no-eval
    const result = eval(expr);
    if (typeof result !== 'number' || Number.isNaN(result)) {
      throw new Error(`Expression did not evaluate to a number: ${expression}`);
    }
    return result;
  }

  private defaultUnit(expression: string, units: RuleSet['units']): string {
    if (expression.includes('area')) return units.area ?? 'ft2';
    if (expression.includes('length')) return units.linear ?? 'ft';
    if (expression.includes('volume')) return units.volume ?? 'ft3';
    return 'ea';
  }

  private ruleFingerprint(rule: MaterialRule): string {
    return Buffer.from(JSON.stringify(rule.when)).toString('base64').slice(0, 8);
  }

  private consolidateMaterials(items: GeneratedMaterial[]): GeneratedMaterial[] {
    const map = new Map<string, GeneratedMaterial>();
    items.forEach((item) => {
      if (map.has(item.sku)) {
        const existing = map.get(item.sku)!;
        existing.qty += item.qty;
        existing.sources.features = [
          ...existing.sources.features,
          ...item.sources.features,
        ];
        if (existing.pricing && item.pricing) {
          existing.pricing.totalPrice =
            (existing.pricing.totalPrice ?? 0) + (item.pricing.totalPrice ?? 0);
        }
      } else {
        map.set(item.sku, { ...item });
      }
    });
    return Array.from(map.values());
  }

  private lookupPricing(sku: string, qty: number) {
    const unitPrice = pricingCatalog[sku];
    if (typeof unitPrice !== 'number') {
      return undefined;
    }
    return {
      unitPrice,
      totalPrice: Number((unitPrice * qty).toFixed(2)),
      currency: 'USD',
    };
  }
}

export const rulesEngineService = new RulesEngineService();

interface NormalizedFeature extends Record<string, unknown> {
  id: string;
  type: string;
  length?: number;
  area?: number;
  count?: number;
  props: Record<string, unknown>;
}

interface GeneratedMaterial {
  sku: string;
  qty: number;
  uom: string;
  description?: string;
  ruleId: string;
  pricing?: {
    unitPrice?: number;
    totalPrice?: number;
    currency?: string;
  };
  sources: {
    features: string[];
    rule: string;
  };
}

const pricingCatalog: Record<string, number> = {
  'STUD-362-20GA': 8.5,
  'GWB-58X-TypeX': 12.75,
  'INSUL-ACOUSTIC': 0.95,
  'STUD-600-18GA': 12.5,
  'SHEATH-OSB-716': 14.25,
  'AIR-BARRIER': 0.95,
  'PVC-2IN': 3.25,
  'PIPE-HANGER': 2.5,
  'DUCT-12X12': 9.5,
  'REGISTER-12X12': 42,
  'PLBG-SINK-PKG': 320,
  'PLBG-TRAP': 28,
  'PLBG-TOILET': 450,
  'PLBG-CARRIER': 120,
};


