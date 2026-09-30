import { z } from 'zod';
import { defineAction } from '../types.ts';
import { tokenOf, type DcrsClient } from './client.ts';
import { BUDGET, fit, WEB_ONLY_IN_LISTS, without } from './fit.ts';
import { documentId, isoDate, limit, searchWords, segment, text } from './inputs.ts';
import { documentForModel, documentsForModel, figuresForModel, todayForModel } from './shape.ts';

/** The documents themselves, the day's facts, figures from history and HR Master Data. All of them only read. */
export function documentActions(dcrs: DcrsClient) {
  return [
    defineAction({
      name: 'find_documents',
      description:
        "Finds the person's documents (formats) by words, format number (F/HR/17) or module: id, formatNo, name, schedule, department. No q: all of them. Also names matches kept to other departments, and formats not in DCRS yet.",
      kind: 'read',
      input: z.object({ q: searchWords.optional(), limit: limit(50) }),
      describe: (input) => (input.q ? `Find the documents matching "${input.q}"` : 'List your documents'),
      run: async (ctx, input) => {
        const answer = await dcrs.json('GET', '/api/v1/documents', { token: tokenOf(ctx.credentials), query: { q: input.q, limit: input.limit ?? 20 } });
        return documentsForModel(answer);
      },
    }),
    defineAction({
      name: 'get_document',
      description: 'One document: what it is for, who fills it in, when (its schedule), its fields and its format details.',
      kind: 'read',
      input: z.object({ documentId }),
      describe: (input) => `Read document ${input.documentId}`,
      run: async (ctx, input) => {
        const answer = await dcrs.json('GET', `/api/v1/documents/${segment(input.documentId)}`, { token: tokenOf(ctx.credentials) });
        return documentForModel(answer);
      },
    }),
    defineAction({
      name: 'todays_facts',
      description: 'Today for this person: working day or holiday, the next holidays, and what is due, overdue and pending, with record ids.',
      kind: 'read',
      input: z.object({}),
      describe: () => "Read today's facts",
      run: async (ctx) => todayForModel(await dcrs.json('GET', '/api/v1/today', { token: tokenOf(ctx.credentials) })),
    }),
    defineAction({
      name: 'history_figures',
      description:
        "Figures from past records for a question about history (trend, most or least, counts, on time). Pass the person's question; answer from the evidence it returns.",
      kind: 'read',
      input: z.object({ question: text(600), documentId: documentId.optional(), from: isoDate.optional(), to: isoDate.optional() }),
      describe: (input) => `Work out the figures for "${input.question}"`,
      run: async (ctx, input) => {
        const answer = await dcrs.json('GET', '/api/v1/figures', {
          token: tokenOf(ctx.credentials),
          query: { question: input.question, documentId: input.documentId, from: input.from, to: input.to },
        });
        return figuresForModel(answer);
      },
    }),
    defineAction({
      name: 'hr_master_lookup',
      description: 'Looks people up on HR Master Data by name or GP3 number: department and designation. Human Resources accounts only.',
      kind: 'read',
      input: z.object({ q: text(100) }),
      describe: (input) => `Look up "${input.q}" on HR Master Data`,
      run: async (ctx, input) => {
        const answer = await dcrs.json('GET', '/api/v1/people', { token: tokenOf(ctx.credentials), query: { q: input.q } });
        return fit(without(answer, WEB_ONLY_IN_LISTS), BUDGET.list);
      },
    }),
  ];
}
