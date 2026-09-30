import { z } from 'zod';
import { defineAction } from '../types.ts';
import { PDF_TIMEOUT_MS, tokenOf, type DcrsClient } from './client.ts';
import { BUDGET, fit, WEB_ONLY, WEB_ONLY_IN_LISTS, without } from './fit.ts';
import { isoDate, pdfForPerson, searchWords, segment, spoken, text } from './inputs.ts';

const status = z.enum(['open', 'closed', 'all']).optional();
// "id" is the key DCRS's database overview reads a finding from (overview.assistant_action_targets), and "date" the
// day of a pest control report.
const findingId = text(200);

/** The routes DCRS offered first: CAPA findings, customer complaints and the daily pest control report. */
export function findingActions(dcrs: DcrsClient) {
  return [
    defineAction({
      name: 'list_findings',
      description:
        'Lists CAPA findings (pest control inspections): id, ref, finding, target date, status. status: open (default, overdue too), closed or all; q: words; from, to: report dates.',
      kind: 'read',
      input: z.object({ status, q: searchWords.optional(), from: isoDate.optional(), to: isoDate.optional() }),
      describe: (input) => `List the ${input.status === 'all' ? '' : `${input.status ?? 'open'} `}CAPA findings${input.q ? ` about "${input.q}"` : ''}`,
      run: async (ctx, input) => {
        const answer = await dcrs.json('GET', '/api/v1/findings', {
          token: tokenOf(ctx.credentials),
          query: { status: input.status, q: input.q, from: input.from, to: input.to, limit: 30 },
        });
        return fit(without(answer, WEB_ONLY_IN_LISTS), BUDGET.list);
      },
    }),
    defineAction({
      name: 'get_finding',
      description: 'One CAPA finding by its ref or id (such as CAPA-2023-12-13-2).',
      kind: 'read',
      input: z.object({ id: findingId }),
      describe: (input) => `Read CAPA finding ${input.id}`,
      run: async (ctx, input) =>
        fit(without(await dcrs.json('GET', `/api/v1/findings/${segment(input.id)}`, { token: tokenOf(ctx.credentials) }), WEB_ONLY), BUDGET.one),
    }),
    defineAction({
      name: 'close_finding',
      description: 'Closes an open CAPA finding with a note of how it was resolved. id: its ref from list_findings, else its id.',
      kind: 'write',
      input: z.object({ id: findingId, note: text(1000) }),
      describe: (input) => `Close CAPA finding ${input.id} with the note: ${spoken(input.note, 300)}`,
      run: async (ctx, input) => {
        const answer = await dcrs.json('POST', `/api/v1/findings/${segment(input.id)}/close`, { token: tokenOf(ctx.credentials), body: { note: input.note } });
        return fit(without(answer, WEB_ONLY), BUDGET.change);
      },
    }),
    defineAction({
      name: 'list_complaints',
      description: 'Lists customer complaints (F/MKT/05): number, customer, job, progress, status. status: open (default), closed or all; q: number, customer or job.',
      kind: 'read',
      input: z.object({ status, q: searchWords.optional() }),
      describe: (input) => `List the ${input.status === 'all' ? '' : `${input.status ?? 'open'} `}customer complaints${input.q ? ` about "${input.q}"` : ''}`,
      run: async (ctx, input) => {
        const answer = await dcrs.json('GET', '/api/v1/complaints', { token: tokenOf(ctx.credentials), query: { status: input.status, q: input.q } });
        return fit(without(answer, WEB_ONLY_IN_LISTS), BUDGET.list);
      },
    }),
    defineAction({
      name: 'get_pest_control_report',
      description: 'The daily pest control record (F/HR/17) of a date as a PDF to open, download or share. It needs the date: ask if the person did not say.',
      kind: 'read',
      input: z.object({ date: isoDate }),
      describe: (input) => `Get the daily pest control report for ${input.date}`,
      run: async (ctx, input) => {
        const pdf = await dcrs.file('/api/v1/pest-control/daily-report', {
          token: tokenOf(ctx.credentials),
          query: { date: input.date },
          mimeType: 'application/pdf',
          timeoutMs: PDF_TIMEOUT_MS,
        });
        return pdfForPerson(pdf, `F-HR-17 Daily Pest Control Monitoring Record ${input.date}.pdf`, { date: input.date });
      },
    }),
    defineAction({
      name: 'get_pest_control_report_summary',
      description: 'The daily pest control record (F/HR/17) of a date as data: check points, rodents caught, observations, who checked and verified it.',
      kind: 'read',
      input: z.object({ date: isoDate }),
      describe: (input) => `Read the daily pest control report for ${input.date}`,
      run: async (ctx, input) => {
        const answer = await dcrs.json('GET', '/api/v1/pest-control/daily-report/summary', { token: tokenOf(ctx.credentials), query: { date: input.date } });
        return fit(without(answer, WEB_ONLY), BUDGET.one);
      },
    }),
  ];
}
