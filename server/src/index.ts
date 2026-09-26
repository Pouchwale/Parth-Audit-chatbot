import { claudeModel } from './agent/model.ts';
import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { connectors, SIGN_IN_CONNECTOR } from './connectors/index.ts';
import { createRegistry } from './connectors/registry.ts';
import { openDatabase } from './db/index.ts';
import { startMaintenance } from './maintenance.ts';

const config = loadConfig();
const database = await openDatabase(config.databaseUrl);
const registry = createRegistry(connectors(config), SIGN_IN_CONNECTOR);
const app = await buildApp({ config, db: database.db, registry, model: claudeModel(config) });
const stopMaintenance = startMaintenance(database.db, config, app.log);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    stopMaintenance();
    await app.close();
    await database.close();
    process.exit(0);
  });
}

await app.listen({ port: config.port, host: config.host });
