// What of DCRS's answers the model is given. DCRS answers in full (a record carries its layout, how a patch is written,
// its values in words and as stored, and up to 50 history entries), while the model's budget is a few thousand
// characters an answer. So each kind of answer keeps what the model needs to act first (ids, status, what can be done,
// the field keys and the patch shape), then adds the rest while it fits, and says what it left out. Every answer is
// read defensively: an answer shaped otherwise is passed on, cut to the budget by fit().
import { BUDGET, fit, shorten, WEB_ONLY, without } from './fit.ts';

type Obj = Record<string, unknown>;

const isObj = (value: unknown): value is Obj => !!value && typeof value === 'object' && !Array.isArray(value);
const size = (value: unknown) => JSON.stringify(value ?? null).length;
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** The keys of `value` that are set, in this order, leaving out the empty ones. */
function pick(value: Obj, keys: readonly string[]): Obj {
  const out: Obj = {};
  for (const key of keys) {
    const item = value[key];
    if (item !== undefined && item !== null && item !== '' && !(Array.isArray(item) && item.length === 0)) out[key] = item;
  }
  return out;
}

/** What an answer had to leave out, or cut short, to fit its budget. */
interface Notes {
  leftOut: string[];
  cut: string[];
}
const notes = (): Notes => ({ leftOut: [], cut: [] });
/** Room kept for the notes finish() adds. */
const NOTE_ROOM = 120;

/**
 * Adds `value` under `key` if the whole still fits `budget`; else, unless it must be whole, as much of it as fits;
 * else notes it as left out.
 */
function addWhileFits(target: Obj, key: string, value: unknown, budget: number, said: Notes, whole = false): void {
  if (value === undefined || value === null) return;
  const room = budget - size(target) - key.length - 4 - NOTE_ROOM;
  if (size(value) <= room) {
    target[key] = value;
    return;
  }
  if (!whole && room >= 300) {
    const shortened = shorten(value, room);
    if (size(shortened) <= room) {
      target[key] = shortened;
      said.cut.push(key);
      return;
    }
  }
  said.leftOut.push(key);
}

function finish(target: Obj, said: Notes, budget: number): unknown {
  if (said.cut.length > 0) target.cutShort = `Cut short to keep this brief: ${said.cut.join(', ')}.`;
  if (said.leftOut.length > 0) target.leftOut = `Not shown, to keep this brief: ${said.leftOut.join(', ')}.`;
  return fit(target, budget);
}

const departmentName = (value: unknown) => (isObj(value) ? (value.name ?? value.code) : value);

/** A document as a list shows it. */
function documentBrief(doc: unknown): unknown {
  if (!isObj(doc)) return doc;
  const schedule = isObj(doc.schedule) ? (doc.schedule.rule ?? doc.schedule.frequency) : doc.schedule;
  return {
    ...pick(doc, ['id', 'formatNo', 'name', 'module']),
    ...(schedule ? { schedule } : {}),
    ...(doc.department ? { department: departmentName(doc.department) } : {}),
    ...(doc.referenceOnly === true ? { referenceOnly: true } : {}),
  };
}

/** A history entry, without the before-and-after of every field. */
function historyBrief(entry: unknown): unknown {
  if (!isObj(entry)) return entry;
  const changes = list(entry.changes).length;
  return { ...pick(entry, ['at', 'by', 'action', 'note', 'fromStatus']), ...(changes ? { fieldsChanged: changes + (Number(entry.moreChanges) || 0) } : {}) };
}

/** A record as a list shows it; the document's own details only when the list is not of one document. */
function recordBrief(item: unknown, oneDocument: boolean): unknown {
  if (!isObj(item)) return item;
  return {
    recordId: item.recordId ?? null,
    ...(oneDocument ? {} : pick(item, ['documentId', 'formatNo', 'document'])),
    ...pick(item, ['dueDate', 'status', 'submittedBy', 'verifiedBy', 'snippet', 'problems']),
  };
}

/** find_documents: the person's documents, the ones kept by other departments, and the formats not in DCRS yet. */
export function documentsForModel(answer: unknown): unknown {
  if (!isObj(answer) || !Array.isArray(answer.documents)) return fit(without(answer, WEB_ONLY), BUDGET.list);
  return fit({ ...pick(answer, ['query', 'total']), documents: answer.documents.map(documentBrief), ...pick(answer, ['kept', 'notInDcrs']) }, BUDGET.list);
}

/** get_document: what it is, who fills it in, when and how, then its layout and how a patch is written. */
export function documentForModel(answer: unknown): unknown {
  if (!isObj(answer)) return fit(answer, BUDGET.one);
  const out: Obj = { ...(documentBrief(answer) as Obj), ...pick(answer, ['kind', 'revisionNo', 'revisionDate', 'description', 'what', 'who', 'when', 'how', 'patchShape']) };
  const said = notes();
  addWhileFits(out, 'records', answer.records, BUDGET.one, said);
  addWhileFits(out, 'layout', answer.layout, BUDGET.one, said);
  return finish(without(out, WEB_ONLY) as Obj, said, BUDGET.one);
}

const TODAY_LISTS = ['overdue', 'due', 'needsInput', 'readyToSubmit', 'awaitingVerification', 'upcoming'] as const;

/** todays_facts: the day, then what is overdue, due and waiting, then the next holidays and the day in words. */
export function todayForModel(answer: unknown): unknown {
  if (!isObj(answer)) return fit(answer, BUDGET.list);
  const day = (value: unknown) => (isObj(value) ? pick(value, ['date', 'weekday', 'kind', 'name', 'label']) : value);
  const hours = isObj(answer.workingHours) ? pick(answer.workingHours, ['hoursText', 'todayText']) : undefined;
  const out: Obj = { ...pick(answer, ['date']), ...(answer.day ? { day: day(answer.day) } : {}), ...(hours && Object.keys(hours).length ? { workingHours: hours } : {}) };
  const said = notes();
  for (const key of TODAY_LISTS) {
    const items = list(answer[key]);
    if (items.length === 0) continue;
    const shown = key === 'upcoming' ? items.slice(0, 5) : items;
    addWhileFits(out, key, [...shown.map((item) => recordBrief(item, false)), ...(shown.length < items.length ? [`…and ${items.length - shown.length} more`] : [])], BUDGET.list, said);
  }
  if (answer.tomorrow) addWhileFits(out, 'tomorrow', day(answer.tomorrow), BUDGET.list, said);
  if (answer.weeklyOff) addWhileFits(out, 'weeklyOff', answer.weeklyOff, BUDGET.list, said);
  if (Array.isArray(answer.nextHolidays)) addWhileFits(out, 'nextHolidays', answer.nextHolidays.slice(0, 4).map(day), BUDGET.list, said);
  if (typeof answer.facts === 'string') addWhileFits(out, 'facts', answer.facts, BUDGET.list, said);
  return finish(out, said, BUDGET.list);
}

/** list_records and search_records: each record's id, date and status (and the search's snippet). */
export function recordsForModel(answer: unknown): unknown {
  const items = isObj(answer) ? (Array.isArray(answer.records) ? answer.records : Array.isArray(answer.hits) ? answer.hits : undefined) : undefined;
  if (!isObj(answer) || !items) return fit(without(answer, WEB_ONLY), BUDGET.list);
  const key = Array.isArray(answer.records) ? 'records' : 'hits';
  const oneDocument = !!answer.document || (items.length > 0 && items.every((item) => isObj(item) && isObj(items[0]) && item.documentId === items[0].documentId));
  const first = items.find(isObj);
  const document = answer.document ? documentBrief(answer.document) : oneDocument && first ? pick(first, ['documentId', 'formatNo', 'document']) : undefined;
  return fit(
    {
      ...(isObj(document) && Object.keys(document).length > 0 ? { document } : {}),
      ...pick(answer, ['query', 'from', 'to', 'status', 'total', 'complete', 'note']),
      [key]: items.map((item) => recordBrief(item, oneDocument)),
    },
    BUDGET.list,
  );
}

/** get_record (and the record open_record answers with): what it is and what can be done first, then its values. */
export function recordForModel(record: unknown, budget: number = BUDGET.one): unknown {
  if (!isObj(record)) return fit(record, budget);
  const document = isObj(record.document) ? { ...pick(record.document, ['formatNo', 'name', 'kind']), ...(record.document.department ? { department: departmentName(record.document.department) } : {}) } : record.document;
  const out: Obj = {
    ...pick(record, ['recordId', 'documentId']),
    ...(document ? { document } : {}),
    ...pick(record, ['date', 'status', 'editable', 'canReopen', 'actions', 'submittedBy', 'submittedAt', 'verifiedBy', 'verifiedAt', 'sentBackBy', 'sentBackBecause', 'correction', 'photos', 'formatRevision']),
    ...(isObj(record.prepared) ? { prepared: pick(record.prepared, ['at', 'notes']) } : {}),
    ...pick(record, ['patchShape']),
  };
  const said = notes();
  addWhileFits(out, 'layout', record.layout, budget, said);
  addWhileFits(out, 'inWords', record.inWords, budget, said);
  const history = list(record.history);
  if (history.length > 0) {
    addWhileFits(out, 'history', history.slice(-4).map(historyBrief), budget, said);
    if (out.history && Number(record.historyTotal) > 4) out.historyTotal = record.historyTotal;
  }
  addWhileFits(out, 'linked', record.linked, budget, said);
  // The values as stored only whole, and only when the values in words are whole too: they say the same for reading.
  if (said.cut.includes('inWords') && record.data !== undefined) said.leftOut.push('data');
  else addWhileFits(out, 'data', record.data, budget, said, true);
  return finish(without(out, WEB_ONLY) as Obj, said, budget);
}

/** open_record: whether it was started just now, and the record. */
export function openedForModel(answer: unknown): unknown {
  if (!isObj(answer) || !isObj(answer.record)) return recordForModel(answer);
  return { created: answer.created === true, record: recordForModel(answer.record, BUDGET.one - 40) };
}

/** What a change did: the record's status and next steps, the fields changed and any problems, the history lines. */
export function changeForModel(answer: unknown): unknown {
  if (!isObj(answer)) return fit(answer, BUDGET.change);
  const out: Obj = { ...(without(answer, WEB_ONLY) as Obj) };
  if (Array.isArray(out.history)) out.history = out.history.map(historyBrief);
  return fit(out, BUDGET.change);
}

/** history_figures: the period and the evidence lines, with a few of the records they came from. */
export function figuresForModel(answer: unknown): unknown {
  if (!isObj(answer) || !Array.isArray(answer.evidence)) return fit(without(answer, WEB_ONLY), BUDGET.list);
  return fit({ ...pick(answer, ['question', 'period', 'from', 'to', 'topics']), evidence: answer.evidence, recordIds: list(answer.recordIds).slice(0, 5) }, BUDGET.list);
}
