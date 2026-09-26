import { loadConfig } from './config.ts';
import { connectors, SIGN_IN_CONNECTOR } from './connectors/index.ts';
import { createRegistry } from './connectors/registry.ts';
import { startServer } from './server.ts';

const config = loadConfig();
await startServer(config, createRegistry(connectors(config), SIGN_IN_CONNECTOR));
