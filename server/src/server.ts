import { groqModel } from './agent/model.ts';
import { buildApp } from './app.ts';
import type { Config } from './config.ts';
import type { Registry } from './connectors/registry.ts';
import { openDatabase } from './db/index.ts';
import { startMaintenance } from './maintenance.ts';

/** Opens the database, starts the API and shuts both down cleanly on Ctrl+C. */
export async function startServer(config: Config, registry: Registry, options: { logLevel?: 'info' | 'warn' } = {}) {
  const database = await openDatabase(config.databaseUrl);
  const app = await buildApp(
    { config, db: database.db, registry, model: groqModel(config) },
    { logger: { level: options.logLevel ?? 'info' } },
  );
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
  if (!config.groqApiKey) app.log.warn('GROQ_API_KEY is not set: people can sign in, but the assistant cannot answer yet.');
  return app;
}
