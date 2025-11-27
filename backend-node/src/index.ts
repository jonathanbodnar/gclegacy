import './startup/register-module-alias';
import { buildApp } from './app';
import { connectDatabase } from './database/connection';
import { ensureDefaultClient } from './services/client.service';
import { ensureDefaultRuleSets } from './startup/ensure-default-rule-sets';
import { config } from './config/env';
import { logger } from './utils/logger';

const start = async () => {
  await connectDatabase();
  await ensureDefaultClient();
  await ensureDefaultRuleSets();

  const app = buildApp();

  app.listen(config.port, () => {
    logger.info(
      `REST API running on http://localhost:${config.port}${config.apiPrefix}`,
    );
  });
};

start().catch((error) => {
  logger.error('Server failed to start', error);
  process.exit(1);
});

