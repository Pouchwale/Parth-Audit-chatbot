import { z } from 'zod';
import { localDate } from '../../time.ts';
import { ConnectorError, defineAction, withFiles, type Connector } from '../types.ts';
import { pestControlPdf } from './pest-control-pdf.ts';
import { DEFAULT_SITE, reportFilename, sampleReport } from './pest-control.ts';

interface Evidence {
  fileId: string;
  filename: string;
  note?: string;
}

interface Finding {
  id: string;
  title: string;
  area: string;
  status: 'open' | 'closed';
  closingNote?: string;
  evidence?: Evidence[];
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

// The connector doesn't know the person's time zone, so a date is only in the future once it hasn't begun anywhere:
// after today in Kiritimati (UTC+14), where each day begins first.
const EARLIEST_ZONE = 'Pacific/Kiritimati';

/**
 * Made-up audit findings and pest control reports for trying the assistant before a real system is connected
 * (npm run demo). Everything is in memory and resets when the server restarts. Never register this in production.
 */
export function createDemoConnector(): Connector {
  const findings = new Map(SAMPLE.map((finding) => [finding.id, { ...finding }]));
  const findingById = (id: string) => {
    const finding = findings.get(id.trim().toUpperCase());
    if (!finding) throw new ConnectorError('not_found', `There is no finding ${id}.`);
    return finding;
  };

  return {
    id: 'demo',
    name: 'Demo Records',
    description: 'Sample audit findings and daily pest control reports for trying the assistant. Not a real system.',
    examples: ['What findings are still open?', 'Close F-101, the pallets were moved', "Get yesterday's pest control report", 'Show me the closed findings'],
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
          const finding = findingById(input.id);
          if (finding.status === 'closed') throw new ConnectorError('conflict', `Finding ${finding.id} is already closed.`);
          finding.status = 'closed';
          finding.closingNote = input.note;
          return finding;
        },
      }),
      defineAction({
        name: 'get_pest_control_report',
        description:
          "Gets the Daily Pest Control Report for one date as a PDF, which the person can open, download and share. It needs the date: if the person didn't say which day, ask them before calling this. Work out words such as \"yesterday\" or \"last Friday\" from today's date.",
        kind: 'read',
        input: z.object({
          date: z.iso.date().describe('The report date, YYYY-MM-DD'),
          site: z.string().trim().min(1).max(80).optional().describe(`The site, if the person named one. Defaults to ${DEFAULT_SITE}.`),
        }),
        describe: (input) => `Get the pest control report for ${input.site ?? DEFAULT_SITE} on ${input.date}`,
        run: async (_ctx, input) => {
          if (input.date > localDate(new Date(), EARLIEST_ZONE)) throw new ConnectorError('invalid_request', 'No report exists for a future date.');
          const report = sampleReport(input.date, input.site ?? DEFAULT_SITE);
          const summary = {
            reportNo: report.reportNo,
            date: report.date,
            site: report.site,
            inspector: report.inspector,
            stationsChecked: report.checks.length,
            stationsWithActivity: report.checks.filter((check) => check.activity !== 'No activity').length,
            pestsSighted: report.sightings,
            sampleData: true,
          };
          return withFiles(summary, [
            {
              filename: reportFilename(report),
              mimeType: 'application/pdf',
              data: await pestControlPdf(report),
              description: `Daily pest control report ${report.reportNo} for ${report.site} on ${report.date} (sample data)`,
            },
          ]);
        },
      }),
      defineAction({
        name: 'attach_evidence',
        description: 'Attaches one of the files in this conversation, such as a photo the person sent, to an audit finding as evidence.',
        kind: 'write',
        input: z.object({
          findingId: z.string().describe('The finding ID, for example F-101'),
          fileId: z.string().describe('The id of the file, from its <attachment> tag'),
          note: z.string().max(500).optional().describe('What the file shows, if the person said'),
        }),
        describe: async (input, { files }) => `Attach "${(await files.get(input.fileId)).info.filename}" to finding ${input.findingId}`,
        run: async (ctx, input) => {
          const finding = findingById(input.findingId);
          const { info } = await ctx.files.get(input.fileId);
          finding.evidence = [...(finding.evidence ?? []), { fileId: info.id, filename: info.filename, ...(input.note ? { note: input.note } : {}) }];
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
