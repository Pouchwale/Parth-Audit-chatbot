// What a call names, asked of DCRS itself before the call is shown or run: the document behind a format number or a
// name, and a document's record of a day. So the assistant can pass on what the person said ("F-QC-30", "the viscosity
// record", "today's") without a lookup of its own first, the confirmation card names the document in full, and a name
// DCRS finds unclear comes back in DCRS's own words, with the documents it could mean.
import { z } from 'zod';
import { ConnectorError, type ActionContext } from '../types.ts';
import { documentLabel, tokenOf, type DcrsClient } from './client.ts';
import { documentId, isoDate, recordId, segment } from './inputs.ts';

/** A document as DCRS knows it. */
export interface NamedDocument {
  id: string;
  /** Its format number and name, such as "F-QC-30 Lamination Adhesive Viscosity Record". */
  label: string;
}

/**
 * How a call names a record: by its id, or as a document's record of a day. The schema leaves all three open, and
 * the call is turned down when it gives neither a record nor a document.
 */
export const recordRef = { recordId: recordId.optional(), documentId: documentId.optional(), date: isoDate.optional() };
const RecordRef = z.object(recordRef);
export type RecordRef = z.infer<typeof RecordRef>;

const WHICH_RECORD = 'Say which record: its recordId, or its documentId with the date.';

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

function named(answer: unknown): NamedDocument {
  if (!isObject(answer) || typeof answer.id !== 'string' || !answer.id) {
    throw new ConnectorError('unavailable', 'DCRS answered in a way the assistant does not understand.');
  }
  return { id: answer.id, label: documentLabel(answer) };
}

/** "today's record of X", or "the record of X for 2026-09-29". */
export function dayRecordWords(label: string, date: string | undefined): string {
  return date ? `the record of ${label} for ${date}` : `today's record of ${label}`;
}

export function dcrsNames(dcrs: DcrsClient) {
  /**
   * The document these words name: its id, its format number as people write it, or its name. DCRS decides, and
   * refuses a name that fits several of the person's documents, one another department keeps, or none.
   */
  async function document(ctx: ActionContext, said: string): Promise<NamedDocument> {
    return named(await dcrs.json('GET', `/api/v1/documents/${segment(said)}`, { token: tokenOf(ctx.credentials) }));
  }

  /** A document's record of a day (DCRS's today when no date is given): its id, or null when it is not started. */
  async function dayRecord(ctx: ActionContext, said: string, date: string | undefined): Promise<{ document: NamedDocument; date: string | undefined; recordId: string | null }> {
    const day = date ?? 'today';
    const answer = await dcrs.json('GET', '/api/v1/records', { token: tokenOf(ctx.credentials), query: { documentId: said, from: day, to: day, limit: 5 } });
    if (!isObject(answer)) throw new ConnectorError('unavailable', 'DCRS answered in a way the assistant does not understand.');
    const document = named(answer.document);
    const started = (Array.isArray(answer.records) ? answer.records : []).flatMap((record) =>
      isObject(record) && typeof record.recordId === 'string' && record.recordId ? [record.recordId] : [],
    );
    if (started.length > 1) {
      throw new ConnectorError('conflict', `${document.label} has ${started.length} records for that day: ${started.join(', ')}. Say which one, by its recordId.`);
    }
    return { document, date: typeof answer.to === 'string' && answer.to ? answer.to : date, recordId: started[0] ?? null };
  }

  /**
   * The record a call names, for the sentence that describes the call: the words for it, and the input with the
   * record's own id in place of the document and date. A record not started yet is left named by its document
   * (DCRS's id for it) and its date when the action can start it (`start`), and turned down otherwise.
   */
  async function record<Input extends RecordRef>(ctx: ActionContext, input: Input, options: { start?: boolean } = {}): Promise<{ input: Input; words: string; started: boolean }> {
    const { recordId: id, documentId: said, date, ...rest } = input;
    if (id) return { input: { ...rest, recordId: id } as Input, words: `record ${id}`, started: true };
    if (!said) throw new ConnectorError('invalid_request', WHICH_RECORD);
    const day = await dayRecord(ctx, said, date);
    const words = dayRecordWords(day.document.label, date);
    if (day.recordId) return { input: { ...rest, recordId: day.recordId } as Input, words, started: true };
    if (!options.start) {
      throw new ConnectorError('not_found', `There is no record of ${day.document.label} for ${date ?? 'today'} yet. open_record starts one.`);
    }
    return { input: { ...rest, documentId: day.document.id, ...(day.date ? { date: day.date } : {}) } as Input, words, started: false };
  }

  /** The id of the record a call names, when it runs. With `start`, a record not started yet is started. */
  async function recordIdOf(ctx: ActionContext, input: RecordRef, options: { start?: boolean } = {}): Promise<{ recordId: string; created: boolean }> {
    if (input.recordId) return { recordId: input.recordId, created: false };
    if (!input.documentId) throw new ConnectorError('invalid_request', WHICH_RECORD);
    if (!options.start) {
      const day = await dayRecord(ctx, input.documentId, input.date);
      if (!day.recordId) throw new ConnectorError('not_found', `There is no record of ${day.document.label} for ${input.date ?? 'today'} yet. open_record starts one.`);
      return { recordId: day.recordId, created: false };
    }
    const opened = await dcrs.json('POST', '/api/v1/records', {
      token: tokenOf(ctx.credentials),
      body: { documentId: input.documentId, ...(input.date ? { date: input.date } : {}) },
    });
    const started = isObject(opened) && isObject(opened.record) ? opened.record.recordId : undefined;
    if (typeof started !== 'string' || !started) throw new ConnectorError('unavailable', 'DCRS answered in a way the assistant does not understand.');
    return { recordId: started, created: isObject(opened) && opened.created === true };
  }

  return { document, record, recordIdOf };
}

export type DcrsNames = ReturnType<typeof dcrsNames>;
