import { z } from 'zod';
import { defineAction } from '../types.ts';
import { tokenOf, type DcrsClient } from './client.ts';
import { searchWords } from './inputs.ts';
import { equipmentForModel, escalationsForModel, insightsForModel } from './shape.ts';

/** How many machines and insights the model is given at most: enough to answer, few enough for the model's budget. */
const MACHINES = 8;
const INSIGHTS = 5;

/**
 * Three more things DCRS's Mitra answers (DCRS's docs/chatbot-integration.md): a machine on the equipment list, what
 * stands out in the person's records, and, for DCRS's super admin, the escalations. All of them only read.
 */
export function plantActions(dcrs: DcrsClient) {
  return [
    defineAction({
      name: 'equipment_lookup',
      description:
        'Machines on the equipment list (F/MNT/01, Maintenance only) by Machine No. (M-47), serial, model, maker or place.',
      kind: 'read',
      input: z.object({ q: searchWords.optional() }),
      describe: (input) => (input.q ? `Look up "${input.q}" on the equipment list (F/MNT/01)` : 'Read the equipment list (F/MNT/01)'),
      run: async (ctx, input) =>
        equipmentForModel(await dcrs.json('GET', '/api/v1/equipment', { token: tokenOf(ctx.credentials), query: { q: input.q, limit: MACHINES } })),
    }),
    defineAction({
      name: 'insights',
      description:
        "What stands out in the person's records: counts by severity and the top findings with evidence. For 'any problems?' or 'what needs attention?'",
      kind: 'read',
      input: z.object({}),
      describe: () => 'Read what stands out in the records',
      run: async (ctx) => insightsForModel(await dcrs.json('GET', '/api/v1/insights', { token: tokenOf(ctx.credentials), query: { limit: INSIGHTS } })),
    }),
    defineAction({
      name: 'escalations',
      description:
        'Escalations to the super admin (super admin only): people or departments often late, or with records not done, in 30 days. status: open (default) or all.',
      kind: 'read',
      input: z.object({ status: z.enum(['open', 'all']).optional() }),
      describe: (input) => (input.status === 'all' ? 'Read the escalations of the last 30 days' : 'Read the escalations waiting for the super admin'),
      run: async (ctx, input) =>
        escalationsForModel(
          await dcrs.json('GET', '/api/v1/escalations', { token: tokenOf(ctx.credentials), query: { open: input.status === 'all' ? '0' : '1' } }),
        ),
    }),
  ];
}
