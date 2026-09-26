import { ConnectorError, type Connector } from '../types.ts';

// Placeholder until the DCRS base URL and a test account are available: its sign-in and its
// small list of allowed actions get defined from the real API, not from guesses.
export function createDcrsConnector(_options: { baseUrl: string | undefined }): Connector {
  return {
    id: 'dcrs',
    name: 'Digital Controlled Record System',
    description: "The factory's audit and compliance record system.",
    actions: [],
    async authenticate() {
      throw new ConnectorError('unavailable', 'The Digital Controlled Record System connector is not set up yet.');
    },
  };
}
