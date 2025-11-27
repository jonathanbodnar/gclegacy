import { MaterialsRuleSetModel } from '../models/materialsRuleSet.model';
import { logger } from '../utils/logger';
import {
  residentialRuleSet,
  standardCommercialRuleSet,
} from '../config/default-rule-sets';

export const ensureDefaultRuleSets = async (): Promise<void> => {
  const seeds = [
    {
      name: 'Standard Commercial Rules',
      version: '1.0',
      rules: standardCommercialRuleSet,
    },
    {
      name: 'Residential Rules',
      version: '1.0',
      rules: residentialRuleSet,
    },
  ];

  for (const seed of seeds) {
    const result = await MaterialsRuleSetModel.updateOne(
      { name: seed.name, version: seed.version },
      {
        $set: {
          rules: seed.rules,
        },
        $setOnInsert: {
          name: seed.name,
          version: seed.version,
        },
      },
      { upsert: true },
    );

    if (result.upsertedCount && result.upsertedCount > 0) {
      logger.info(`Seeded materials rule set: ${seed.name} v${seed.version}`);
    } else if (result.modifiedCount && result.modifiedCount > 0) {
      logger.info(`Updated materials rule set: ${seed.name} v${seed.version}`);
    }
  }
};


