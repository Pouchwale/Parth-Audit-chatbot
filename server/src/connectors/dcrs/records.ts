import { z } from 'zod';
import { ConnectorError, defineAction, type ActionContext } from '../types.ts';
import { PDF_TIMEOUT_MS, tokenOf, type DcrsClient } from './client.ts';
import { documentId, isoDate, limit, patchInWords, pdfForPerson, searchWords, segment, spoken, text } from './inputs.ts';
import { aboutDocument, dcrsNames, dayRecordWords, recordRef } from './names.ts';
import { changeForModel, openedForModel, recordForModel, recordsForModel } from './shape.ts';

/** What a record can be moved on to, as DCRS's own lifecycle names them. */
export const RECORD_ACTIONS = ['submit', 'verify', 'send_back', 'resume', 'reopen', 'cancel_correction', 'delete'] as const;
type RecordAction = (typeof RECORD_ACTIONS)[number];

/** The confirmation card's words for each, given the record's words ("record rec-1", "today's record of F-QC-30 …"), and whether DCRS needs a reason. */
const ACTION_WORDS: Record<RecordAction, { reason: boolean; say: (record: string, reason: string) => string }> = {
  submit: { reason: false, say: (record) => `Submit ${record}` },
  verify: { reason: false, say: (record) => `Verify (approve) ${record}` },
  send_back: { reason: true, say: (record, reason) => `Send ${record} back for changes, saying ${spoken(reason, 200)}` },
  resume: { reason: false, say: (record) => `Resume ${record}, which was sent back, so it can be changed again` },
  reopen: { reason: true, say: (record, reason) => `Reopen ${record} for correction, because ${spoken(reason, 200)}` },
  cancel_correction: { reason: false, say: (record) => `Cancel the correction of ${record} and put it back as it was` },
  delete: { reason: true, say: (record, reason) => `Delete ${record}, because ${spoken(reason, 200)}` },
};

/** The photo types DCRS keeps on a record. */
const PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
/**
 * The largest photo DCRS keeps on a record (its MAX_PHOTO_BYTES): DCRS keeps photos as a 1024 px JPEG at 70%,
 * about 60-150 KB, inside a records item every browser must hold, and cannot scale a picture on its server.
 */
export const MAX_PHOTO_BYTES = 512 * 1024;

/** A photo from this conversation that can go on a record, or the reason it can't. */
async function photo(files: ActionContext['files'], fileId: string) {
  const file = await files.get(fileId);
  const type = file.info.mimeType.toLowerCase();
  if (!PHOTO_TYPES.has(type)) {
    throw new ConnectorError('invalid_request', `"${file.info.filename}" is not a JPEG, PNG or WebP photo, so it can't go on a DCRS record.`);
  }
  if (file.data.byteLength > MAX_PHOTO_BYTES) {
    throw new ConnectorError(
      'invalid_request',
      `"${file.info.filename}" is larger than 512 KB, the most DCRS keeps for a photo on a record. Send it again at a smaller size, such as 1024 pixels on its longer side as a JPEG.`,
    );
  }
  return { ...file, type };
}

/**
 * The records of the documents: finding and reading them, and every change a person can make to one. A record is
 * named by its id, or by its document (id, format number or name) and date, which DCRS itself resolves when the call
 * is described, so the card names the document in full and no lookup is needed first. A change to a record of a day
 * not started yet starts it as part of the change, and the card says so.
 */
export function recordActions(dcrs: DcrsClient) {
  const names = dcrsNames(dcrs);
  const RECORD = z.object(recordRef);

  return [
    defineAction({
      name: 'list_records',
      description:
        'Lists records, of one document or all, from..to (default the last 31 days), newest first. status: Scheduled, Due, In Progress, Submitted, Pending Verification, Verified, Rejected.',
      kind: 'read',
      input: z.object({ documentId: documentId.optional(), from: isoDate.optional(), to: isoDate.optional(), status: text(40).optional(), limit: limit(50) }),
      describe: (input) =>
        `List the records${input.documentId ? ` of ${input.documentId}` : ''}${input.from ? ` from ${input.from}` : ''}${input.to ? ` to ${input.to}` : ''}${input.status ? ` that are ${input.status}` : ''}`,
      run: async (ctx, input) => {
        const answer = await aboutDocument(input.documentId, () =>
          dcrs.json('GET', '/api/v1/records', {
            token: tokenOf(ctx.credentials),
            query: { documentId: input.documentId, from: input.from, to: input.to, status: input.status, limit: input.limit ?? 20 },
          }),
        );
        return recordsForModel(answer);
      },
    }),
    defineAction({
      name: 'search_records',
      description: 'Searches the words written on records (names, codes, remarks), newest first, with snippets. Optional documentId, from, to.',
      kind: 'read',
      input: z.object({ q: searchWords, documentId: documentId.optional(), from: isoDate.optional(), to: isoDate.optional(), limit: limit(20) }),
      describe: (input) => `Search the records for "${input.q}"`,
      run: async (ctx, input) => {
        const answer = await aboutDocument(input.documentId, () =>
          dcrs.json('GET', '/api/v1/records/search', {
            token: tokenOf(ctx.credentials),
            query: { q: input.q, documentId: input.documentId, from: input.from, to: input.to, limit: input.limit ?? 10 },
          }),
        );
        return recordsForModel(answer);
      },
    }),
    defineAction({
      name: 'get_record',
      description: 'Reads a record: status, whether it can be edited, its fields (keys, labels, types, options), values and history. Read it before edit_record.',
      kind: 'read',
      input: RECORD,
      describe: async (input, ctx) => {
        const named = await names.record(ctx, input);
        return { summary: `Read ${named.words}`, input: named.input };
      },
      run: async (ctx, input) => {
        const { recordId } = await names.recordIdOf(ctx, input);
        return recordForModel(await dcrs.json('GET', `/api/v1/records/${segment(recordId)}`, { token: tokenOf(ctx.credentials) }));
      },
    }),
    defineAction({
      name: 'record_pdf',
      description: 'Hands the person a record as DCRS prints it: a PDF to open, download or share.',
      kind: 'read',
      input: RECORD,
      describe: async (input, ctx) => {
        const named = await names.record(ctx, input);
        return { summary: `Print ${named.words} as a PDF`, input: named.input };
      },
      run: async (ctx, input) => {
        const { recordId } = await names.recordIdOf(ctx, input);
        const pdf = await dcrs.file(`/api/v1/records/${segment(recordId)}/pdf`, {
          token: tokenOf(ctx.credentials),
          mimeType: 'application/pdf',
          timeoutMs: PDF_TIMEOUT_MS,
        });
        return pdfForPerson(pdf, `DCRS record ${recordId}.pdf`, { recordId });
      },
    }),
    defineAction({
      name: 'open_record',
      description:
        "A document's record for a date (today if left out), started if there is none: recordId, fields and patch shape. Only to read a record, use get_record.",
      kind: 'write',
      input: z.object({ documentId, date: isoDate.optional() }),
      describe: async (input, ctx) => {
        // DCRS says which document the words name and which day "today" is, so the card names the document in full and
        // what runs is that document's record of that very day — as the steps that fill it are pinned to it
        // (names.record). A card shown at 23:58 and confirmed after midnight still opens the day it showed, not the
        // next one (only the super admin, never held to the staff's hours, works across midnight).
        const day = await names.dayRecord(ctx, input.documentId, input.date);
        const date = day.date ?? input.date;
        return {
          summary: `Open ${dayRecordWords(day.document.label, input.date)}, starting it if there is none yet`,
          input: { ...input, documentId: day.document.id, ...(date ? { date } : {}) },
        };
      },
      run: async (ctx, input) => {
        const answer = await dcrs.json('POST', '/api/v1/records', {
          token: tokenOf(ctx.credentials),
          body: { documentId: input.documentId, ...(input.date ? { date: input.date } : {}) },
        });
        return openedForModel(answer);
      },
    }),
    defineAction({
      name: 'edit_record',
      description:
        'Changes values on a record; get_record first for the field keys and options. patch: {fieldKey: value}; log sheet: {header: {key: value}, itemEdits: [{collection, match: {key: value}, set: {key: value}}]}; F/HR/17: {checkpoints: {"1": "Yes"}}. A submitted or verified record needs record_action reopen first.',
      kind: 'write',
      input: z.object({
        ...recordRef,
        patch: z.object({}).catchall(z.unknown()),
        note: text(500).optional().describe('Why, if the person said'),
      }),
      describe: async (input, ctx) => {
        if (Object.keys(input.patch).length === 0) throw new ConnectorError('invalid_request', 'The patch is empty: say which fields to change.');
        const named = await names.record(ctx, input, { start: true });
        const change = `set ${patchInWords(input.patch)}${input.note ? ` (note: ${spoken(input.note, 120)})` : ''}`;
        return { summary: named.started ? `In ${named.words}, ${change}` : `Start ${named.words} and ${change}`, input: named.input };
      },
      run: async (ctx, input) => {
        const { recordId, created } = await names.recordIdOf(ctx, input, { start: true });
        const answer = await dcrs.json('POST', `/api/v1/records/${segment(recordId)}/changes`, {
          token: tokenOf(ctx.credentials),
          body: { patch: input.patch, ...(input.note ? { note: input.note } : {}) },
        });
        return changeForModel(started(answer, created));
      },
    }),
    defineAction({
      name: 'record_action',
      description:
        "Moves a record on: submit, verify (approve), send_back, resume (after send_back), reopen (for correction), cancel_correction, or delete. send_back, reopen and delete need the person's reason.",
      kind: 'write',
      input: z.object({ ...recordRef, action: z.enum(RECORD_ACTIONS), reason: text(500).optional() }),
      describe: async (input, ctx) => {
        const words = ACTION_WORDS[input.action];
        if (words.reason && !input.reason) {
          throw new ConnectorError('invalid_request', `A reason is needed to ${input.action.replace('_', ' ')} a record. Ask the person why, then try again.`);
        }
        const named = await names.record(ctx, input);
        const summary = words.say(named.words, input.reason ?? '');
        if (input.action !== 'submit') return { summary, input: named.input };
        // A record is submitted only after the person has seen what it says (REQUIREMENTS §62 in DCRS): the card carries
        // its values as DCRS reads them now, and confirming it is the person's review.
        const record = await dcrs.json('GET', `/api/v1/records/${segment(named.input.recordId ?? '')}`, { token: tokenOf(ctx.credentials) });
        return { summary: `${summary}. ${valuesForCard(record)} Confirming says you have reviewed them and they are correct.`, input: named.input };
      },
      run: async (ctx, input) => {
        const { recordId } = await names.recordIdOf(ctx, input);
        const answer = await dcrs.json('POST', `/api/v1/records/${segment(recordId)}/actions`, {
          token: tokenOf(ctx.credentials),
          // Runs only once the person has confirmed the card that showed the values: that is the review DCRS asks of a
          // record the assistant prepared before it takes a submit.
          body: { action: input.action, ...(input.reason ? { reason: input.reason } : {}), ...(input.action === 'submit' ? { reviewed: true } : {}) },
        });
        return changeForModel(answer);
      },
    }),
    defineAction({
      name: 'add_photo_to_record',
      description: "Adds a photo attached in this chat (fileId from its <attachment> tag) to a record's photo or scan list.",
      kind: 'write',
      input: z.object({ ...recordRef, fileId: text(100), note: text(500).optional().describe('What it shows, if the person said') }),
      describe: async (input, ctx) => {
        const { info } = await photo(ctx.files, input.fileId);
        const named = await names.record(ctx, input, { start: true });
        const note = input.note ? ` (note: ${spoken(input.note, 120)})` : '';
        return {
          summary: named.started ? `Add the photo "${info.filename}" to ${named.words}${note}` : `Start ${named.words} and add the photo "${info.filename}" to it${note}`,
          input: named.input,
        };
      },
      run: async (ctx, input) => {
        const { info, data, type } = await photo(ctx.files, input.fileId);
        const { recordId, created } = await names.recordIdOf(ctx, input, { start: true });
        const answer = await dcrs.json('POST', `/api/v1/records/${segment(recordId)}/photos`, {
          token: tokenOf(ctx.credentials),
          body: { fileName: info.filename, mimeType: type, dataBase64: Buffer.from(data).toString('base64'), ...(input.note ? { note: input.note } : {}) },
          timeoutMs: 60_000,
        });
        return changeForModel(started(answer, created));
      },
    }),
    defineAction({
      name: 'fill_record_with_sample_data',
      description: 'Fills a record with realistic sample data, marked as made up. It stays a draft, never submitted.',
      kind: 'write',
      input: RECORD,
      describe: async (input, ctx) => {
        const named = await names.record(ctx, input, { start: true });
        const fill = 'with sample data (made up and marked so; it stays a draft)';
        return { summary: named.started ? `Fill ${named.words} ${fill}` : `Start ${named.words} and fill it ${fill}`, input: named.input };
      },
      run: async (ctx, input) => {
        const { recordId, created } = await names.recordIdOf(ctx, input, { start: true });
        const answer = await dcrs.json('POST', `/api/v1/records/${segment(recordId)}/sample-fill`, { token: tokenOf(ctx.credentials) });
        return changeForModel(started(answer, created));
      },
    }),
  ];
}

/** The most of a record's values a confirmation card shows: about a phone screen of them. */
const CARD_VALUES_CHARS = 700;

/**
 * A record's values for a submit's confirmation card, from DCRS's values in words: "Its values: Line No.: 3; row 1:
 * Status: OK." A long sheet shows what fits and says how many more there are.
 */
export function valuesForCard(record: unknown): string {
  const inWords = record && typeof record === 'object' && Array.isArray((record as { inWords?: unknown }).inWords) ? (record as { inWords: unknown[] }).inWords : [];
  const values = inWords.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const { where, label, value } = item as { where?: unknown; label?: unknown; value?: unknown };
    if (typeof label !== 'string' || value === undefined || value === null || String(value).trim() === '') return [];
    const said = String(value).replace(/\s+/g, ' ').trim();
    return [`${typeof where === 'string' && where ? `${where}: ` : ''}${label}: ${said.length > 120 ? `${said.slice(0, 120)}…` : said}`];
  });
  if (values.length === 0) return 'No values are entered on it yet.';
  let words = '';
  for (const [index, value] of values.entries()) {
    const next = words ? `${words}; ${value}` : value;
    if (next.length > CARD_VALUES_CHARS && words) return `Its values: ${words}; and ${values.length - index} more (open the record to see them all).`;
    words = next;
  }
  return `Its values: ${words}.`;
}

/** A change's answer with a note that the record was started first, when it was. */
function started(answer: unknown, created: boolean): unknown {
  return created && answer && typeof answer === 'object' && !Array.isArray(answer) ? { started: 'The record was started first.', ...answer } : answer;
}
