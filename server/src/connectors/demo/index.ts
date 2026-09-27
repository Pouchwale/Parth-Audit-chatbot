import { z } from 'zod';
import { ConnectorError, defineAction, type Connector } from '../types.ts';

interface Finding {
  id: string;
  title: string;
  area: string;
  status: 'open' | 'closed';
  closingNote?: string;
}

const SAMPLE: Finding[] = [
  { id: 'F-101', title: 'Fire exit blocked by pallets', area: 'Warehouse B', status: 'open' },
  { id: 'F-102', title: 'Missing calibration label on torque wrench', area: 'Assembly line 2', status: 'open' },
  { id: 'F-103', title: 'First-aid kit past its expiry date', area: 'Packing', status: 'open' },
  { id: 'F-104', title: 'Safety guard missing on conveyor', area: 'Assembly line 1', status: 'closed', closingNote: 'Guard refitted' },
];

const ACCOUNTS: Record<string, { password: string; displayName: string }> = {
  demo: { password: 'demo', displayName: 'Demo User' },
  admin: { password: 'admin', displayName: 'Demo Admin' },
};

/**
 * Made-up audit findings for trying the assistant before a real system is connected (npm run demo).
 * Everything is in memory and resets when the server restarts. Never register this in production.
 */
export function createDemoConnector(): Connector {
  const findings = new Map(SAMPLE.map((finding) => [finding.id, { ...finding }]));

  return {
    id: 'demo',
    name: 'Demo Records',
    description: 'Sample audit findings for trying the assistant. Not a real system.',
    examples: ['What findings are still open?', 'Close F-101, the pallets were moved', 'Show me the closed findings'],
    actions: [
      defineAction({
        name: 'list_findings',
        description: 'Lists audit findings with their ID, title, area and status. Use it to answer questions about findings and to look up a finding ID.',
        kind: 'read',
        input: z.object({ status: z.enum(['open', 'closed']).optional().describe('Only list findings with this status') }),
        describe: (input) => (input.status ? `List ${input.status} findings` : 'List all findings'),
        run: async (_ctx, input) => [...findings.values()].filter((finding) => !input.status || finding.status === input.status),
      }),
      defineAction({
        name: 'close_finding',
        description: 'Closes an open audit finding, recording how it was resolved.',
        kind: 'write',
        input: z.object({
          id: z.string().describe('The finding ID, for example F-101'),
          note: z.string().min(1).describe('How the finding was resolved'),
        }),
        describe: (input) => `Close finding ${input.id} with the note "${input.note}"`,
        run: async (_ctx, input) => {
          const finding = findings.get(input.id.trim().toUpperCase());
          if (!finding) throw new ConnectorError('not_found', `There is no finding ${input.id}.`);
          if (finding.status === 'closed') throw new ConnectorError('conflict', `Finding ${finding.id} is already closed.`);
          finding.status = 'closed';
          finding.closingNote = input.note;
          return finding;
        },
      }),
    ],
    async authenticate(username, password) {
      const name = username.trim().toLowerCase();
      const account = ACCOUNTS[name];
      if (!account || account.password !== password) throw new ConnectorError('invalid_credentials', 'Wrong username or password.');
      return { externalId: `demo-${name}`, username: name, displayName: account.displayName, credentials: { demo: true } };
    },
  };
}
