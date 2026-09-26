// Demo mode (npm run demo): the real server with made-up findings instead of DCRS, so the whole
// flow can be tried before DCRS is connected. Accounts: demo/demo, and admin/admin as super admin.
// The database is in memory and everything resets on restart. Never run this in production.
import { randomBytes } from 'node:crypto';
import { loadConfig } from './config.ts';
import { createDemoConnector } from './connectors/demo/index.ts';
import { createRegistry } from './connectors/registry.ts';
import { startServer } from './server.ts';

process.env.CREDENTIALS_KEY ||= randomBytes(32).toString('base64');
const config = loadConfig();
const app = await startServer(
  { ...config, databaseUrl: 'memory://', superAdmins: new Set([...config.superAdmins, 'admin']) },
  createRegistry([createDemoConnector()], 'demo'),
);
app.log.warn('DEMO MODE: sample data; sign in as demo/demo, or admin/admin for the Accounts view. Data resets on restart.');
