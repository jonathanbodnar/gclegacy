import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '@/common/prisma/prisma.service';
import * as yaml from 'js-yaml';

export interface MaterialRule {
  when: Record<string, any>;
  materials: MaterialItem[];
}

export interface MaterialItem {
  sku: string;
  qty: string; // Expression to calculate quantity
  uom?: string;
  description?: string;
}

export interface RuleSet {
  version: number;
  units: {
    linear: string;
    area: string;
    volume?: string;
  };
  vars?: Record<string, any>;
  rules: MaterialRule[];
}

@Injectable()
export class RulesEngineService {
  private readonly logger = new Logger(RulesEngineService.name);

  constructor(private prisma: PrismaService) {}

  async applyRules(jobId: string, ruleSetId: string, features: any[]): Promise<void> {
    this.logger.log(`Applying rules ${ruleSetId} to job ${jobId}`);

    // Get rule set
    const ruleSet = await this.getRuleSet(ruleSetId);
    
    // Process features and generate materials
    const materials = await this.processFeatures(features, ruleSet);
    
    // Save materials to database
    await this.saveMaterials(jobId, materials, ruleSetId);
    
    this.logger.log(`Applied ${materials.length} material items for job ${jobId}`);
  }

  async getRuleSet(ruleSetId: string): Promise<RuleSet> {
    const ruleSetRecord = await this.prisma.materialsRuleSet.findUnique({
      where: { id: ruleSetId },
    });

    if (!ruleSetRecord) {
      throw new BadRequestException(`Rule set not found: ${ruleSetId}`);
    }

    try {
      return ruleSetRecord.rules as RuleSet;
    } catch (error) {
      throw new BadRequestException(`Invalid rule set format: ${error.message}`);
    }
  }

  async createRuleSet(name: string, version: string, rules: string | RuleSet): Promise<string> {
    let parsedRules: RuleSet;

    if (typeof rules === 'string') {
      try {
        // Try parsing as YAML first, then JSON
        parsedRules = yaml.load(rules) as RuleSet;
      } catch (yamlError) {
        try {
          parsedRules = JSON.parse(rules);
        } catch (jsonError) {
          throw new BadRequestException('Invalid YAML/JSON format');
        }
      }
    } else {
      parsedRules = rules;
    }

    // Validate rule set structure
    this.validateRuleSet(parsedRules);

    const ruleSetRecord = await this.prisma.materialsRuleSet.create({
      data: {
        name,
        version,
        rules: parsedRules,
      },
    });

    return ruleSetRecord.id;
  }

  private validateRuleSet(ruleSet: RuleSet): void {
    if (!ruleSet.version || !ruleSet.units || !ruleSet.rules) {
      throw new BadRequestException('Rule set must have version, units, and rules');
    }

    if (!Array.isArray(ruleSet.rules)) {
      throw new BadRequestException('Rules must be an array');
    }

    for (const rule of ruleSet.rules) {
      if (!rule.when || !rule.materials) {
        throw new BadRequestException('Each rule must have "when" and "materials" properties');
      }

      if (!Array.isArray(rule.materials)) {
        throw new BadRequestException('Rule materials must be an array');
      }

      for (const material of rule.materials) {
        if (!material.sku || !material.qty) {
          throw new BadRequestException('Each material must have sku and qty');
        }
      }
    }
  }

  private async processFeatures(features: any[], ruleSet: RuleSet): Promise<any[]> {
    const materials = [];
    const vars = ruleSet.vars || {};

    for (const feature of features) {
      // Find matching rules for this feature
      const matchingRules = ruleSet.rules.filter(rule => 
        this.evaluateCondition(rule.when, feature, vars)
      );

      for (const rule of matchingRules) {
        for (const materialItem of rule.materials) {
          try {
            const qty = this.evaluateExpression(materialItem.qty, feature, vars);
            
            if (qty > 0) {
              materials.push({
                sku: materialItem.sku,
                qty,
                uom: materialItem.uom || this.getDefaultUom(materialItem.qty, ruleSet.units),
                source: {
                  ruleId: this.generateRuleId(rule),
                  featureId: feature.id,
                  featureType: feature.type,
                },
                description: materialItem.description,
              });
            }
          } catch (error) {
            this.logger.warn(`Error evaluating material ${materialItem.sku}: ${error.message}`);
          }
        }
      }
    }

    // Consolidate materials by SKU
    return this.consolidateMaterials(materials);
  }

  private evaluateCondition(condition: Record<string, any>, feature: any, vars: Record<string, any>): boolean {
    for (const [key, value] of Object.entries(condition)) {
      const featureValue = this.getFeatureValue(feature, key);
      
      if (featureValue !== value) {
        return false;
      }
    }
    
    return true;
  }

  private getFeatureValue(feature: any, path: string): any {
    const parts = path.split('.');
    let value = feature;
    
    for (const part of parts) {
      if (value && typeof value === 'object') {
        value = value[part] || value.props?.[part];
      } else {
        return undefined;
      }
    }
    
    return value;
  }

  private evaluateExpression(expression: string, feature: any, vars: Record<string, any>): number {
    // Simple expression evaluator
    // In production, you'd want a more robust and secure expression parser
    
    // Replace variables
    let expr = expression;
    
    // Replace feature properties
    expr = expr.replace(/(\w+)/g, (match) => {
      if (vars.hasOwnProperty(match)) {
        return vars[match].toString();
      }
      
      const featureValue = this.getFeatureValue(feature, match);
      if (featureValue !== undefined) {
        return featureValue.toString();
      }
      
      return match;
    });

    // Basic math operations (be very careful with eval in production!)
    try {
      // Only allow basic math operations for security
      if (!/^[0-9+\-*/.() ]+$/.test(expr)) {
        throw new Error('Invalid expression');
      }
      
      return eval(expr);
    } catch (error) {
      throw new Error(`Cannot evaluate expression: ${expression}`);
    }
  }

  private getDefaultUom(expression: string, units: any): string {
    if (expression.includes('area') || expression.includes('Area')) {
      return units.area || 'ft2';
    }
    if (expression.includes('length') || expression.includes('Length')) {
      return units.linear || 'ft';
    }
    if (expression.includes('volume') || expression.includes('Volume')) {
      return units.volume || 'ft3';
    }
    
    return 'ea'; // Default to each
  }

  private generateRuleId(rule: MaterialRule): string {
    // Generate a stable ID for the rule based on its content
    const ruleString = JSON.stringify(rule.when);
    return Buffer.from(ruleString).toString('base64').substring(0, 8);
  }

  private consolidateMaterials(materials: any[]): any[] {
    const consolidated = new Map();
    
    for (const material of materials) {
      const key = material.sku;
      
      if (consolidated.has(key)) {
        const existing = consolidated.get(key);
        existing.qty += material.qty;
        existing.source.features = existing.source.features || [];
        existing.source.features.push(material.source.featureId);
      } else {
        consolidated.set(key, {
          ...material,
          source: {
            ...material.source,
            features: [material.source.featureId],
          },
        });
      }
    }
    
    return Array.from(consolidated.values());
  }

  private async saveMaterials(jobId: string, materials: any[], ruleSetId: string): Promise<void> {
    // Delete existing materials for this job
    await this.prisma.material.deleteMany({
      where: { jobId },
    });

    // Create new materials
    for (const material of materials) {
      await this.prisma.material.create({
        data: {
          jobId,
          sku: material.sku,
          qty: material.qty,
          uom: material.uom,
          ruleId: material.source.ruleId,
          sources: material.source,
        },
      });
    }
  }
}
