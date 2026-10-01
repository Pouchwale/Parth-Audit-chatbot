import { z } from 'zod';
import { ConnectorError, defineAction, type DescribeContext } from '../types.ts';
import { PDF_TIMEOUT_MS, tokenOf, type DcrsClient } from './client.ts';
import { documentId, isoDate, limit, patchInWords, pdfForPerson, recordId, searchWords, segment, spoken, text } from './inputs.ts';
import { changeForModel, openedForModel, recordForModel, recordsForModel } from './shape.ts';

/** What a record can be moved on to, as DCRS's own lifecycle names them. */
export const RECORD_ACTIONS = ['submit', 'verify', 'send_back', 'resume', 'reopen', 'cancel_correction', 'delete'] as const;
type RecordAction = (typeof RECORD_ACTIONS)[number];

/** The confirmation card's words for each, and whether DCRS needs a reason. */
const ACTION_WORDS: Record<RecordAction, { reason: boolean; say: (id: string, reason: string) => string }> = {
  submit: { reason: false, say: (id) => `Submit record ${id}` },
  verify: { reason: false, say: (id) => `Verify (approve) record ${id}` },
  send_back: { reason: true, say: (id, reason) => `Send record ${id} back for changes, saying ${spoken(reason, 200)}` },
  resume: { reason: false, say: (id) => `Resume record ${id}, which was sent back, so it can be changed again` },
  reopen: { reason: true, say: (id, reason) => `Reopen record ${id} for correction, because ${spoken(reason, 200)}` },
  cancel_correction: { reason: false, say: (id) => `Cancel the correction of record ${id} and put it back as it was` },
  delete: { reason: true, say: (id, reason) => `Delete record ${id}, because ${spoken(reason, 200)}` },
};

/** The photo types DCRS keeps on a record. */
const PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
/**
 * The largest photo DCRS keeps on a record (its MAX_PHOTO_BYTES): DCRS keeps photos as a 1024 px JPEG at 70%,
 * about 60-150 KB, inside a records item every browser must hold, and cannot scale a picture on its server.
 */
export const MAX_PHOTO_BYTES = 512 * 1024;

/** A photo from this conversation that can go on a record, or the reason it can't. */
async function photo(files: DescribeContext['files'], fileId: string) {
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

/** The records of the documents: finding and reading them, and every change a person can make to one. */
export function recordActions(dcrs: DcrsClient) {
  return [
    defineAction({
      name: 'list_records',
      description:
        "Lists a document's records (or every document's) from..to (default the last 31 days), newest first: recordId, date, status. Optional status: Scheduled, Due, In Progress, Submitted, Pending Verification, Verified, Rejected.",
      kind: 'read',
      input: z.object({ documentId: documentId.optional(), from: isoDate.optional(), to: isoDate.optional(), status: text(40).optional(), limit: limit(50) }),
      describe: (input) =>
        `List the records${input.documentId ? ` of ${input.documentId}` : ''}${input.from ? ` from ${input.from}` : ''}${input.to ? ` to ${input.to}` : ''}${input.status ? ` that are ${input.status}` : ''}`,
      run: async (ctx, input) => {
        const answer = await dcrs.json('GET', '/api/v1/records', {
          token: tokenOf(ctx.credentials),
          query: { documentId: input.documentId, from: input.from, to: input.to, status: input.status, limit: input.limit ?? 20 },
        });
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
        const answer = await dcrs.json('GET', '/api/v1/records/search', {
          token: tokenOf(ctx.credentials),
          query: { q: input.q, documentId: input.documentId, from: input.from, to: input.to, limit: input.limit ?? 10 },
        });
        return recordsForModel(answer);
      },
    }),
    defineAction({
      name: 'get_record',
      description: 'Reads a record: document, date, status, whether it can be edited, its fields (keys, labels, types, options), values and history. Read it before edit_record.',
      kind: 'read',
      input: z.object({ recordId }),
      describe: (input) => `Read record ${input.recordId}`,
      run: async (ctx, input) => {
        const answer = await dcrs.json('GET', `/api/v1/records/${segment(input.recordId)}`, { token: tokenOf(ctx.credentials) });
        return recordForModel(answer);
      },
    }),
    defineAction({
      name: 'record_pdf',
      description: "Hands the person a record as a PDF of DCRS's printed page, to open, download or share (print, download or share a record).",
      kind: 'read',
      input: z.object({ recordId }),
      describe: (input) => `Print record ${input.recordId} as a PDF`,
      run: async (ctx, input) => {
        const pdf = await dcrs.file(`/api/v1/records/${segment(input.recordId)}/pdf`, {
          token: tokenOf(ctx.credentials),
          mimeType: 'application/pdf',
          timeoutMs: PDF_TIMEOUT_MS,
        });
        return pdfForPerson(pdf, `DCRS record ${input.recordId}.pdf`, { recordId: input.recordId });
      },
    }),
    defineAction({
      name: 'open_record',
      description:
        "Gets a document's record (documentId or format number) for a date, today if left out, starting it if there is none: its recordId, fields and patch shape. To read an existing record, list_records finds it without asking.",
      kind: 'write',
      input: z.object({ documentId, date: isoDate.optional() }),
      describe: (input) =>
        input.date
          ? `Open the record of ${input.documentId} for ${input.date}, starting it if there is none yet`
          : `Open today's record of ${input.documentId}, starting it if there is none yet`,
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
        recordId,
        patch: z.object({}).catchall(z.unknown()),
        note: text(500).optional().describe('Why, if the person said'),
      }),
      describe: (input) => {
        if (Object.keys(input.patch).length === 0) throw new ConnectorError('invalid_request', 'The patch is empty: say which fields to change.');
        return `In record ${input.recordId}, set ${patchInWords(input.patch)}${input.note ? ` (note: ${spoken(input.note, 120)})` : ''}`;
      },
      run: async (ctx, input) => {
        const answer = await dcrs.json('POST', `/api/v1/records/${segment(input.recordId)}/changes`, {
          token: tokenOf(ctx.credentials),
          body: { patch: input.patch, ...(input.note ? { note: input.note } : {}) },
        });
        return changeForModel(answer);
      },
    }),
    defineAction({
      name: 'record_action',
      description:
        "Moves a record on: submit, verify (approve), send_back, resume (a sent-back record), reopen (for correction), cancel_correction (undo a reopen) or delete. send_back, reopen and delete need the person's reason.",
      kind: 'write',
      input: z.object({ recordId, action: z.enum(RECORD_ACTIONS), reason: text(500).optional() }),
      describe: (input) => {
        const words = ACTION_WORDS[input.action];
        if (words.reason && !input.reason) {
          throw new ConnectorError('invalid_request', `A reason is needed to ${input.action.replace('_', ' ')} a record. Ask the person why, then try again.`);
        }
        return words.say(input.recordId, input.reason ?? '');
      },
      run: async (ctx, input) => {
        const answer = await dcrs.json('POST', `/api/v1/records/${segment(input.recordId)}/actions`, {
          token: tokenOf(ctx.credentials),
          body: { action: input.action, ...(input.reason ? { reason: input.reason } : {}) },
        });
        return changeForModel(answer);
      },
    }),
    defineAction({
      name: 'add_photo_to_record',
      description: "Adds a photo attached in this chat (fileId from its <attachment> tag) to a record's photo or scan list.",
      kind: 'write',
      input: z.object({ recordId, fileId: text(100), note: text(500).optional().describe('What it shows, if the person said') }),
      describe: async (input, { files }) =>
        `Add the photo "${(await photo(files, input.fileId)).info.filename}" to record ${input.recordId}${input.note ? ` (note: ${spoken(input.note, 120)})` : ''}`,
      run: async (ctx, input) => {
        const { info, data, type } = await photo(ctx.files, input.fileId);
        const answer = await dcrs.json('POST', `/api/v1/records/${segment(input.recordId)}/photos`, {
          token: tokenOf(ctx.credentials),
          body: { fileName: info.filename, mimeType: type, dataBase64: Buffer.from(data).toString('base64'), ...(input.note ? { note: input.note } : {}) },
          timeoutMs: 60_000,
        });
        return changeForModel(answer);
      },
    }),
    defineAction({
      name: 'fill_record_with_sample_data',
      description: 'Fills a record with realistic sample data, marked as made up. It stays a draft and is never submitted.',
      kind: 'write',
      input: z.object({ recordId }),
      describe: (input) => `Fill record ${input.recordId} with sample data (made up and marked so; it stays a draft)`,
      run: async (ctx, input) => {
        const answer = await dcrs.json('POST', `/api/v1/records/${segment(input.recordId)}/sample-fill`, { token: tokenOf(ctx.credentials) });
        return changeForModel(answer);
      },
    }),
  ];
}
