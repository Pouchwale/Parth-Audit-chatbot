// DCRS answers can be long (a log sheet's rows, a record's whole history), while every word a tool hands the model
// counts against the Groq key's tokens a minute. So each answer is cut to a budget before the model sees it: long
// lists keep their first items and say how many more there were, long text is shortened, and the answer says so.

/**
 * How much of an answer the model is given, in characters of JSON (about four make a token). Every answer stays in the
 * conversation and is sent again with each later request, and the key allows 8,000 tokens a minute in all.
 */
export const BUDGET = {
  /** A list: documents, records, findings, search hits. */
  list: 3_000,
  /** One thing in full: a record with its fields, a document with its fields. */
  one: 4_500,
  /** What a change did. */
  change: 2_000,
} as const;

/** The DCRS web app's own page routes: nothing a phone can open, so they are left out. */
export const WEB_ONLY = new Set(['route']);
/** In a list, the links to the DCRS web app are left out too: one per item costs more than it helps. */
export const WEB_ONLY_IN_LISTS = new Set(['route', 'link']);

/** Said in an answer that had to be shortened, so the model knows it did not see everything. */
export const SHORTENED = 'Shortened to keep it brief: ask about fewer records, or one record at a time, to see the rest.';

const STEPS: readonly (readonly [items: number, chars: number])[] = [
  [60, 800],
  [30, 400],
  [15, 200],
  [8, 120],
  [4, 80],
  [2, 50],
  [1, 30],
];
const MAX_DEPTH = 8;

function size(value: unknown): number {
  return JSON.stringify(value ?? null).length;
}

function shrink(value: unknown, items: number, chars: number, depth: number): unknown {
  if (typeof value === 'string') return value.length > chars ? `${value.slice(0, chars)}…` : value;
  if (Array.isArray(value)) {
    if (depth >= MAX_DEPTH) return `(${value.length} items)`;
    const kept = value.slice(0, items).map((item) => shrink(item, items, chars, depth + 1));
    return value.length > items ? [...kept, `…and ${value.length - items} more not shown`] : kept;
  }
  if (value && typeof value === 'object') {
    if (depth >= MAX_DEPTH) return '(more detail not shown)';
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, shrink(item, items, chars, depth + 1)]));
  }
  return value;
}

/** A shortened copy of a part of an answer, as small as it has to be to fit `maxChars`, with no note of its own. */
export function shorten(value: unknown, maxChars: number): unknown {
  if (size(value) <= maxChars) return value;
  let shrunk: unknown = value;
  for (const [items, chars] of STEPS) {
    shrunk = shrink(value, items, chars, 0);
    if (size(shrunk) <= maxChars) break;
  }
  return shrunk;
}

/** The value itself when it fits in `maxChars` of JSON, else a shortened copy that says it was shortened. */
export function fit(value: unknown, maxChars: number): unknown {
  if (size(value) <= maxChars) return value;
  const shrunk = shorten(value, maxChars - SHORTENED.length - 20);
  if (shrunk && typeof shrunk === 'object' && !Array.isArray(shrunk)) return { ...shrunk, shortened: SHORTENED };
  return { items: shrunk, shortened: SHORTENED };
}

/** A copy without these keys at any depth, such as the DCRS web app's own page routes, which mean nothing on a phone. */
export function without(value: unknown, keys: ReadonlySet<string>): unknown {
  if (Array.isArray(value)) return value.map((item) => without(item, keys));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !keys.has(key))
        .map(([key, item]) => [key, without(item, keys)]),
    );
  }
  return value;
}
