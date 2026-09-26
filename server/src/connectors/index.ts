import type { Config } from '../config.ts';
import { createDcrsConnector } from './dcrs/index.ts';
import type { Connector } from './types.ts';

/** Every system the assistant can act on. Adding a system means adding its connector here. */
export function connectors(config: Config): Connector[] {
  return [createDcrsConnector({ baseUrl: config.dcrsBaseUrl })];
}

/** The connector people sign in with. */
export const SIGN_IN_CONNECTOR = 'dcrs';
