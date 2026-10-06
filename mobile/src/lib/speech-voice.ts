// HOW MITRA SPEAKS. Plain functions with no imports, so the server's tests can check them
// (server/test/speech-voice.test.ts); lib/speech.ts does the speaking, with expo-speech.
//
// The owner (2-Oct-2026): "make the voice accent more like a human", and "Gujarati asked, Gujarati answered; the same
// for Hindi and English". So a reply is said:
//   - by the voice of its own language, told from its script (voiceSegments): Gujarati script by a gu-IN voice,
//     Devanagari by a hi-IN voice, the rest by Indian English (en-IN), the accent staff hear every day. A reply that
//     mixes them, such as a Gujarati answer with an English card after it, is said part by part, each by its own voice.
//     An English voice can't read Gujarati or Hindi letters at all, so they are never given to one.
//   - by the best voice the device has for that language (chooseVoice): one that sounds like a person first (the
//     iPhone's Premium and Enhanced voices, Android's Google voices, Edge's "Online (Natural)" voices), then any voice
//     of the language; for English, Indian English first among equally good ones. Robotic voices (the iPhone's
//     Eloquence and novelty voices, eSpeak) come last.
//   - a touch slower than the engines' everyday speed, at the voice's own pitch (PROSODY).
//   - as a person reads it out (forTheEar): no markdown marks, "F/QC/30" as "F Q C 30", dates as people say them in
//     that language, a record's long id left out (the screen shows it), each list item a sentence with a pause after.
//
// The text-for-the-ear rules follow DCRS's own Mitra (frontend/src/utils/earText.ts and scripts.ts in DCRS), so the
// plant hears the same thing from both.

export type SpeechLanguage = 'en' | 'gu' | 'hi';

/** The language tag each language is spoken with: Indian English, Gujarati and Hindi as spoken in India. */
export const SPEECH_TAGS: Record<SpeechLanguage, string> = { en: 'en-IN', gu: 'gu-IN', hi: 'hi-IN' };

/** Each language's name, for telling the person. */
export const LANGUAGE_NAMES: Record<SpeechLanguage, string> = { en: 'English', gu: 'Gujarati', hi: 'Hindi' };

/**
 * How Mitra talks: a touch slower than the engines' everyday speed of 1, which is quick for a noisy shop floor and
 * for someone listening in their second language; 0.95 is a person explaining something across a desk, not reading
 * it out. The pitch is left at the voice's own (1): moving it is what makes a natural voice sound processed.
 */
export const PROSODY = { rate: 0.95, pitch: 1 } as const;

// ── Which language a piece of text is in ────────────────────────────────────────────────────────

const WORDS = /[\p{L}\p{M}]+/gu;
const GUJARATI_LETTER = /\p{Script=Gujarati}/u;
const DEVANAGARI_LETTER = /\p{Script=Devanagari}/u;
const LATIN_LETTER = /\p{Script=Latin}/u;

interface WordCounts {
  en: number;
  gu: number;
  hi: number;
  other: number;
}

function scriptOfWord(word: string): keyof WordCounts {
  const first = /\p{L}/u.exec(word)?.[0] ?? '';
  if (GUJARATI_LETTER.test(first)) return 'gu';
  if (DEVANAGARI_LETTER.test(first)) return 'hi';
  if (LATIN_LETTER.test(first)) return 'en';
  return 'other';
}

/** The words of `text`, counted by script. Words, not letters: Gujarati and Hindi write their vowels as marks. */
function wordCounts(text: string): WordCounts {
  const counts: WordCounts = { en: 0, gu: 0, hi: 0, other: 0 };
  for (const word of text.match(WORDS) ?? []) counts[scriptOfWord(word)] += 1;
  return counts;
}

// The everyday little words of a Gujarati or a Hindi sentence: one of them marks the sentence as that language even
// when most of its words are English names ("Line Clearance Checklist ભરો."). The server tells a request's language
// by the same words (server/src/agent/language.ts): keep the two lists alike.
const GUJARATI_GRAMMAR = new Set([
  'છે', 'છો', 'છું', 'અને', 'માં', 'નું', 'ની', 'નો', 'ના', 'ને', 'થી', 'પર', 'માટે', 'એટલે', 'કે', 'પણ', 'તો', 'કરો', 'ભરો',
  'હતું', 'હતી', 'હશે', 'નથી', 'શું', 'કયું', 'કયો', 'કેટલા', 'ક્યારે', 'આજે', 'બાકી', 'પછી', 'પહેલાં', 'તેનું', 'આ', 'એ',
]);
const HINDI_GRAMMAR = new Set([
  'है', 'हैं', 'और', 'में', 'का', 'की', 'के', 'को', 'से', 'पर', 'लिए', 'यानी', 'मतलब', 'भी', 'तो', 'करें', 'भरें', 'था', 'थी',
  'नहीं', 'क्या', 'कौन', 'कितने', 'कब', 'आज', 'बाकी', 'बाद', 'पहले', 'इसका', 'यह', 'वह',
]);

/**
 * The language a sentence is said in: Gujarati or Hindi when a third or more of its words are in that script, or one
 * of its little grammar words is; else English. Null when it has no words at all ("92%", "---").
 */
export function sentenceLanguage(sentence: string): SpeechLanguage | null {
  const c = wordCounts(sentence);
  const indic = c.gu + c.hi;
  const all = indic + c.en + c.other;
  if (all === 0) return null;
  if (indic === 0) return 'en';
  const grammar = (sentence.match(WORDS) ?? []).some((word) => GUJARATI_GRAMMAR.has(word) || HINDI_GRAMMAR.has(word));
  if (grammar || indic / all >= 0.3) return c.gu >= c.hi ? 'gu' : 'hi';
  return 'en';
}

/** The language most of a reply is in, by the same rule as one sentence. Null when it has no words. */
export function mainLanguage(text: string): SpeechLanguage | null {
  return sentenceLanguage(text);
}

/** A line cut after each sentence: a full stop, a question or exclamation mark or an ellipsis followed by a space or the end; the danda (। ॥) always. */
function sentencePieces(line: string): string[] {
  return line
    .split(/(?<=[.!?…])\s+|(?<=[।॥])\s*/)
    .map((piece) => piece.trim())
    .filter(Boolean);
}

export interface VoiceSegment {
  language: SpeechLanguage;
  /** The words, line breaks kept: a markdown list is read item by item (forTheEar). */
  text: string;
}

/**
 * A reply as the parts different voices say, in order. A sentence with no words takes the language of the one before
 * it (else the one after; else English). A reply with a sentence plainly in Gujarati (or Hindi) is that language's
 * reply: its other sentences that hold words of that script are said by that voice too ("F/HR/05 એટલે Induction
 * Training Record": a Gujarati answer naming an English document), never by the English voice with them taken out.
 */
export function voiceSegments(text: string): VoiceSegment[] {
  const pieces: { text: string; startsLine: boolean; language: SpeechLanguage | null }[] = [];
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    sentencePieces(line).forEach((piece, i) => pieces.push({ text: piece, startsLine: i === 0, language: sentenceLanguage(piece) }));
  }
  if (pieces.length === 0) return [];
  const indic = new Set(pieces.map((p) => p.language).filter((l): l is 'gu' | 'hi' => l === 'gu' || l === 'hi'));
  if (indic.size > 0) {
    for (const piece of pieces) {
      if (piece.language !== 'en') continue;
      const c = wordCounts(piece.text);
      const own = c.gu >= c.hi ? 'gu' : 'hi';
      if (c.gu + c.hi > 0 && indic.has(own)) piece.language = own;
    }
  }
  for (let i = 1; i < pieces.length; i++) {
    if (pieces[i]!.language === null) pieces[i]!.language = pieces[i - 1]!.language;
  }
  for (let i = pieces.length - 2; i >= 0; i--) {
    if (pieces[i]!.language === null) pieces[i]!.language = pieces[i + 1]!.language;
  }
  const out: VoiceSegment[] = [];
  for (const piece of pieces) {
    const language = piece.language ?? 'en';
    const last = out.at(-1);
    if (last && last.language === language) last.text += `${piece.startsLine ? '\n' : ' '}${piece.text}`;
    else out.push({ language, text: piece.text });
  }
  return out;
}

// ── Text made for the ear ────────────────────────────────────────────────────────────────────────

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** The months as a person says them in Gujarati and in Hindi. */
const MONTHS_IN: Record<'gu' | 'hi', string[]> = {
  gu: ['જાન્યુઆરી', 'ફેબ્રુઆરી', 'માર્ચ', 'એપ્રિલ', 'મે', 'જૂન', 'જુલાઈ', 'ઓગસ્ટ', 'સપ્ટેમ્બર', 'ઓક્ટોબર', 'નવેમ્બર', 'ડિસેમ્બર'],
  hi: ['जनवरी', 'फ़रवरी', 'मार्च', 'अप्रैल', 'मई', 'जून', 'जुलाई', 'अगस्त', 'सितंबर', 'अक्टूबर', 'नवंबर', 'दिसंबर'],
};

/** A month as the plant writes it ("Sep", "Sept", "September", "SEP") to its index; anything else is not a month. */
function monthOf(word: string): number | null {
  const w = word.toLowerCase();
  for (let i = 0; i < MONTHS.length; i++) {
    const full = MONTHS[i]!.toLowerCase();
    if (w === full || w === full.slice(0, 3) || (i === 8 && w === 'sept')) return i;
  }
  return null;
}

/** 1st, 2nd, 3rd, 4th … 11th, 12th, 13th … 21st. */
function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  const unit = n % 10;
  return `${n}${unit === 1 ? 'st' : unit === 2 ? 'nd' : unit === 3 ? 'rd' : 'th'}`;
}

/**
 * "30th September", or "30th September 2025" when the year is not this one; in Gujarati and Hindi the day's plain
 * number and the month's own name ("30 સપ્ટેમ્બર", "30 सितंबर"). Null for a day that is not a date.
 */
function spokenDate(day: number, month: number, year: number | null, thisYear: number, language: SpeechLanguage): string | null {
  if (!(month >= 0 && month <= 11) || !(day >= 1 && day <= 31)) return null;
  const full = year !== null && year < 100 ? 2000 + year : year;
  const yearSaid = full !== null && full !== thisYear ? ` ${full}` : '';
  return language === 'en' ? `${ordinal(day)} ${MONTHS[month]}${yearSaid}` : `${day} ${MONTHS_IN[language][month]}${yearSaid}`;
}

/** "2:30 PM", "9 AM", "12 PM". */
function spokenTime(h: number, m: number): string {
  const suffix = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 || 12;
  return m === 0 ? `${h12} ${suffix}` : `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}

const spell = (letters: string): string => letters.toUpperCase().split('').join(' ');

/** What is said for a block of code, which is not read out. */
const CODE_LEFT_OUT: Record<SpeechLanguage, string> = { en: 'Code block omitted.', gu: 'કોડ છોડી દીધો.', hi: 'कोड छोड़ दिया।' };

/** Markdown and line breaks: what a reader sees, said as sentences (a Hindi line ends in the danda). */
function unmark(text: string, language: SpeechLanguage): string {
  const en = language === 'en';
  const stop = language === 'hi' ? '।' : '.';
  let s = text.replace(/\r\n?/g, '\n');
  s = s.replace(/```[\s\S]*?(?:```|$)/g, `\n${CODE_LEFT_OUT[language]}\n`);
  s = s.replace(/!?\[([^\]\n]*)\]\((?:[^()\s]|\([^()\s]*\))*\)/g, '$1');
  s = s.replace(/\b(?:https?:\/\/|www\.)[^\s<>()]+/gi, en ? 'a link' : '');
  const lines = s.split('\n').map((line) => {
    let l = line.trim();
    if (!l) return '';
    // A table's rule, or a horizontal rule.
    if (/^\|?[\s:|-]+\|?$/.test(l) && l.includes('-') && (l.includes('|') || /^-{3,}$/.test(l))) return '';
    l = l.replace(/^#{1,6}\s*/, '');
    // A quote mark, never the ">" of ">25%".
    l = l.replace(/^>(?!=?\s*[-−]?\d)\s?/, '');
    l = l.replace(/^(?:[-*+•·]|\d{1,3}[.)])\s+/, '');
    if (l.includes('|')) {
      l = l
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map((cell) => cell.trim())
        .filter(Boolean)
        .join(', ');
    }
    return l;
  });
  // Each line is said as a sentence of its own: one with no stop at its end gets one, so the voice pauses there.
  s = lines
    .filter(Boolean)
    .map((l) => (/[.!?:;,…।]["'”’)]*$/.test(l) ? l : `${l}${stop}`))
    .join(' ');
  s = s.replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '$2');
  s = s.replace(/(^|[\s(])[*_](?=\S)([^*_\n]*?\S)[*_](?=[\s).,!?:;।]|$)/g, '$1$2');
  s = s.replace(/`([^`]*)`/g, '$1');
  s = s.replace(/~~([^~]+)~~/g, '$1');
  return s;
}

/** Pictures are not read: emoji, flags, ticks and crosses become the short pause a reader makes over them. */
function unpicture(s: string): string {
  return s
    .replace(/\p{Emoji_Modifier}|\p{Variation_Selector}|\p{Join_Control}/gu, '')
    .replace(/(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|[✓✔✗✘☐☑☒★☆])+/gu, ', ');
}

/** A record's long id: twelve characters or more, and one part of four or more mixing letters and figures. */
function isLongId(token: string): boolean {
  return token.length >= 12 && token.split(/[-_.:]/).some((part) => part.length >= 4 && /[A-Za-z]/.test(part) && /\d/.test(part));
}

// A record's long id ("rec-mg8x9k2a-1f-abc123", a UUID) is for the screen, not the ear: an "id" or "ID:" label before
// it goes with it, and so do the brackets it leaves empty. A lot number such as "LOT-2026-0915-A" is still said.
const ID_LIKE = /(\bids?\s*[:#]?\s*)?\b([A-Za-z0-9]+(?:[-_.:][A-Za-z0-9]+){2,})\b/gi;

function withoutIds(s: string): string {
  return s
    .replace(/\[rec:[^\]\s]{1,120}\]/gi, '')
    .replace(ID_LIKE, (whole: string, _label: string | undefined, token: string) => (isLongId(token) ? '' : whole))
    .replace(/\(\s*\)|\[\s*\]/g, '');
}

/** Words in Gujarati or Devanagari script: an English voice can't say them, so an English part is given without them. */
function withoutIndicWords(s: string): string {
  return s.replace(/[\p{Script=Gujarati}\p{Script=Devanagari}][\p{L}\p{M}]*/gu, ' ').replace(/[।॥]/g, '.');
}

/** Format numbers, spelled as a person reads them: F/QC/30, F-QC-30 and F/QC/15-B as "F Q C 30", "F Q C 15 B". */
function formatNumbers(s: string): string {
  return s.replace(
    /\bF\s?[/-]\s?([A-Za-z]{2,4})\s?[/-]\s?(\d{1,3})(?:[-.]([A-Za-z])(?![A-Za-z]))?(?![\d/])/g,
    (_whole: string, dept: string, num: string, letter: string | undefined) =>
      `F ${spell(dept)} ${num.length > 1 && num.startsWith('0') ? `0 ${num.slice(1)}` : num}${letter ? ` ${letter.toUpperCase()}` : ''}`,
  );
}

/** Machine numbers (M-16, PRD-01): the letters one by one, the number after them. */
function machineNumbers(s: string): string {
  return s.replace(/\b([A-Z]{1,3})-(\d{1,4})\b/g, (_whole: string, letters: string, num: string) => `${spell(letters)} ${num}`);
}

function datesAndTimes(s: string, thisYear: number, language: SpeechLanguage): string {
  // 2026-09-30
  s = s.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (whole: string, y: string, m: string, d: string) => spokenDate(Number(d), Number(m) - 1, Number(y), thisYear, language) ?? whole);
  // 30-Sep-2026, 30 Sep 2026, 30 September, 30-Sep-26. The month starts with a capital ("3 may be late" is not a
  // date); a two-figure year only after a dash, slash or point ("30 Sep, 12 records" keeps its 12).
  s = s.replace(
    /\b(\d{1,2})(?:st|nd|rd|th)?[-\s/.]([A-Z][A-Za-z]{2,8})\.?(?:(?:[-/.]|,?\s)(\d{4})(?!\d)|[-/.](\d{2})(?!\d))?(?![A-Za-z])/g,
    (whole: string, d: string, mon: string, y4: string | undefined, y2: string | undefined) => {
      const month = monthOf(mon);
      if (month === null) return whole;
      const y = y4 ?? y2;
      return spokenDate(Number(d), month, y ? Number(y) : null, thisYear, language) ?? whole;
    },
  );
  // 30/09/2026, 30.09.2026, 30-09-2026 (day first, as the plant writes them)
  s = s.replace(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b/g, (whole: string, d: string, m: string, y: string) => spokenDate(Number(d), Number(m) - 1, Number(y), thisYear, language) ?? whole);
  // A Gujarati or Hindi voice says "14:30" as a person there does: the clock is left to it.
  if (language !== 'en') return s;
  // 14:30, 09:00, 9:00 am, 17:45:00
  return s.replace(/\b([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?(?:\s?([AaPp])\.?\s?[Mm]\.?(?![A-Za-z]))?/g, (_whole: string, h: string, m: string, ap: string | undefined) => {
    let hour = Number(h);
    if (ap) {
      const pm = ap.toLowerCase() === 'p';
      if (hour === 12) hour = pm ? 12 : 0;
      else if (pm) hour += 12;
    }
    return spokenTime(hour, Number(m));
  });
}

const WORDS_FOR: [RegExp, string][] = [
  [/\bSr\.?\s?No\.?/gi, 'serial number'],
  [/\band\/or\b/gi, 'and or'],
  [/\bN\/A\b/g, 'not applicable'],
  [/\be\.g\.(?=\s|,|$)/gi, 'for example'],
  [/\bi\.e\.(?=\s|,|$)/gi, 'that is'],
  [/\betc\.(?=\s|,|$)/gi, 'etcetera'],
  [/\betc\b/gi, 'etcetera'],
  [/\bvs\.?(?=\s)/gi, 'versus'],
  [/\bapprox\.?(?=\s)/gi, 'about'],
  [/\bQty\b\.?/gi, 'quantity'],
  [/\bDept\b\.?/gi, 'department'],
  [/\bNo\.\s?(?=\d)/g, 'number '],
  [/#\s?(?=\d)/g, 'number '],
];

const UNITS: Record<string, string> = {
  kg: 'kilograms',
  kgs: 'kilograms',
  mm: 'millimetres',
  cm: 'centimetres',
  ml: 'millilitres',
  hr: 'hours',
  hrs: 'hours',
  min: 'minutes',
  mins: 'minutes',
  sec: 'seconds',
  secs: 'seconds',
};

/** In Gujarati and Hindi: per cent, rupees and degrees in the language's own words. */
const AMOUNTS_IN: Record<'gu' | 'hi', { percent: string; rupees: string; celsius: string }> = {
  gu: { percent: 'ટકા', rupees: 'રૂપિયા', celsius: 'ડિગ્રી સેલ્સિયસ' },
  hi: { percent: 'प्रतिशत', rupees: 'रुपये', celsius: 'डिग्री सेल्सियस' },
};

function amountsAndSymbols(s: string, language: SpeechLanguage): string {
  if (language !== 'en') {
    const w = AMOUNTS_IN[language];
    s = s.replace(/(\d)\s?%/g, `$1 ${w.percent}`);
    s = s.replace(/(?:₹|\bRs\.?|\bINR)\s?(\d+(?:,\d+)*(?:\.\d+)?)/g, `$1 ${w.rupees}`);
    return s.replace(/(\d)\s?°\s?C\b/g, `$1 ${w.celsius}`);
  }
  s = s.replace(/(\d)\s?%/g, '$1 percent');
  // The amount's own commas only: "₹1,200, then" is "1,200 rupees, then".
  s = s.replace(/(?:₹|\bRs\.?|\bINR)\s?(\d+(?:,\d+)*(?:\.\d+)?)/g, '$1 rupees');
  s = s.replace(/(\d)\s?°\s?C\b/g, '$1 degrees Celsius');
  s = s.replace(/(\d)\s?°\s?F\b/g, '$1 degrees Fahrenheit');
  s = s.replace(/(\d)\s?°/g, '$1 degrees');
  // A rate is "per", never two choices: 1.3 gm/ccm, 120 gm/sq.m., kg/cm², 20 ml / 1 lit; before units are said in words.
  s = s.replace(
    /(\d\s?[A-Za-z]{1,12}|\b(?:kgs?|gms?|mg|g|km|mm|cm|m|ml|ltr|lit|l|ccm|cc|hrs?|h|mins?|secs?|s))\/((?:sq\.?\s?m\.?|cm²|m²|ccm|cc|cm|mm|m|ml|ltr|lit|l|kgs?|gms?|g|hrs?|h|mins?|secs?|s|day|week|month|year))(?![\w/])/gi,
    '$1 per $2',
  );
  s = s.replace(/(\d\s?[A-Za-z]{1,12})\s\/\s(?=\d)/g, '$1 per ');
  s = s.replace(/(\d)\s?(kgs?|mm|cm|ml|hrs?|mins?|secs?)\b/gi, (_whole: string, n: string, unit: string) => `${n} ${UNITS[unit.toLowerCase()] ?? unit}`);
  for (const [pattern, words] of WORDS_FOR) s = s.replace(pattern, words);
  s = s.replace(/(\d)\s?[x×]\s?(\d)/g, '$1 by $2');
  // A range stands on its own ("10-20 mm" is "10 to 20"); figures inside a code (LOT-2026-0915-A, 26-27/001) are not one.
  s = s.replace(/(?<![\w/-])(\d{1,4}(?:\.\d+)?)\s?[–-]\s?(\d{1,4}(?:\.\d+)?)(?![\w/-])/g, '$1 to $2');
  // Comparisons, next to a number only ("<25% = C" is "less than 25 percent is C"); "->" and "=>" are left for the arrows.
  s = s.replace(/<=\s?(?=[-−]?\d)/g, ' at most ');
  s = s.replace(/(?<![-=])>=\s?(?=[-−]?\d)/g, ' at least ');
  s = s.replace(/<\s?(?=[-−]?\d)/g, ' less than ');
  s = s.replace(/(?<![-=])>\s?(?=[-−]?\d)/g, ' more than ');
  s = s.replace(/(?<=[\w%)])\s?=\s?(?=[\w(−-])/g, ' is ');
  s = s.replace(/(^|[\s(])[−-](\d)/g, '$1minus $2');
  s = s.replace(/−/g, ' minus ');
  s = s.replace(/±/g, ' plus or minus ');
  s = s.replace(/≥/g, ' at least ');
  s = s.replace(/≤/g, ' at most ');
  s = s.replace(/\s&\s|&/g, ' and ');
  s = s.replace(/(\S)@(\S)/g, '$1 at $2');
  // "Yes/No" is "Yes or No", but a code such as QC/WP/38 or FLX/SOP/19 stays one code.
  s = s.replace(/(?<![\w/])([A-Za-z]{2,})\/([A-Za-z]{2,})(?![\w/])/g, '$1 or $2');
  // A score is "out of" (45 / 50); a frequency is "a" (Once / Year).
  s = s.replace(/(\d)\s\/\s(?=\d)/g, '$1 out of ');
  s = s.replace(/\s\/\s(?=(?:day|week|month|year|shift|batch)\b)/gi, ' a ');
  return s.replace(/\s\/\s/g, ' or ');
}

/** Dashes and brackets as the pauses they stand for; leftover marks dropped; spaces and stops tidied. */
function pausesAndTidy(s: string): string {
  s = s.replace(/\s[—–-]{1,2}\s|—|–/g, ', ');
  s = s.replace(/[()[\]{}]/g, ', ');
  s = s.replace(/→|⇒|->/g, ' to ');
  s = s.replace(/[*_~^`|\\<>=•·»«]/g, ' ');
  s = s.replace(/\s+/g, ' ');
  s = s.replace(/\s+([,.;:!?…।])/g, '$1');
  s = s.replace(/,(?:\s*,)+/g, ',');
  s = s.replace(/,\s*([.;:!?…।])/g, '$1');
  s = s.replace(/([.;:!?…।])\s*,/g, '$1');
  s = s.replace(/([.!?…।])\s*।/g, '$1');
  s = s.replace(/।\s*\.(?!\.)/g, '।');
  s = s.replace(/^[,\s]+/, '');
  s = s.replace(/[,\s]+$/, '');
  s = s.replace(/\.{3,}/g, '…');
  s = s.replace(/\.{2}/g, '.');
  return s.trim();
}

/**
 * The text as a person would read it out in `language` (see the header): Gujarati and Hindi get only what is not
 * English (markdown, pictures, ids, format numbers, dates with the month in their own words, per cent, rupees and
 * degrees). `now` decides this year, which a date is said without. Never throws: a slip gives the text back as it was.
 */
export function forTheEar(text: string, language: SpeechLanguage, now: Date = new Date()): string {
  const original = String(text ?? '');
  if (!original.trim()) return '';
  try {
    let s = unmark(original, language);
    s = unpicture(s);
    s = withoutIds(s);
    if (language === 'en') s = withoutIndicWords(s);
    s = formatNumbers(s);
    s = datesAndTimes(s, now.getFullYear(), language);
    s = machineNumbers(s);
    s = amountsAndSymbols(s, language);
    s = pausesAndTidy(s);
    // Nothing left to say (only pictures, or for an English voice only Gujarati or Hindi words): silence, not "dot".
    return /[\p{L}\p{N}]/u.test(s) ? s : '';
  } catch {
    return original.replace(/\s+/g, ' ').trim();
  }
}

/** A sentence longer than a piece: cut at its commas, else between words. */
function cutLong(sentence: string, maxChars: number): string[] {
  if (sentence.length <= maxChars) return [sentence];
  const out: string[] = [];
  let current = '';
  for (const part of sentence.split(/(?<=[,;:])\s+|\s+/)) {
    if (current && current.length + 1 + part.length > maxChars) {
      out.push(current);
      current = part;
    } else current = current ? `${current} ${part}` : part;
  }
  if (current) out.push(current);
  // A single word longer than a piece (a long code) is cut where it must be.
  return out.flatMap((piece) => (piece.length <= maxChars ? [piece] : (piece.match(new RegExp(`[\\s\\S]{1,${maxChars}}`, 'g')) ?? [])));
}

/**
 * The pieces a text is said in: whole sentences, as many as fit in `maxChars`, so the voice phrases across them like a
 * person and pauses between pieces where a sentence ends. A sentence longer than that is cut at its commas.
 */
export function speechPieces(text: string, maxChars: number): string[] {
  const sentences = text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?…])\s+|(?<=[।॥])\s*/)
    .map((s) => s.trim())
    .filter(Boolean)
    .flatMap((sentence) => cutLong(sentence, maxChars));
  const out: string[] = [];
  let current = '';
  for (const sentence of sentences) {
    if (current && current.length + 1 + sentence.length > maxChars) {
      out.push(current);
      current = sentence;
    } else current = current ? `${current} ${sentence}` : sentence;
  }
  if (current) out.push(current);
  return out;
}

// ── Which voice ──────────────────────────────────────────────────────────────────────────────────

/** A voice as expo-speech lists it (Speech.getAvailableVoicesAsync). */
export interface VoiceInfo {
  identifier: string;
  name: string;
  /** "Enhanced" or "Default". iPhones say Enhanced for their Enhanced voices, Android for its better-than-normal ones; browsers never do. */
  quality: string;
  language: string;
}

// Names that say a voice is a woman's or a man's, whole words only ("Microsoft Neerja Online (Natural) - English
// (India)", "com.apple.voice.compact.en-IN.Rishi"). Mitra speaks with a woman's voice where it can tell, as DCRS's
// Mitra does by default, so the voice stays the same person from one language to the next.
const FEMALE_NAMES = new Set([
  'neerja', 'heera', 'ધ્વની', 'dhwani', 'swara', 'स्वरा', 'kalpana', 'aditi', 'raveena', 'isha', 'lekha', 'kiyara', 'veena',
  'sangeeta', 'priya', 'ananya', 'zira', 'samantha', 'karen', 'moira', 'tessa', 'kate', 'serena', 'susan', 'hazel', 'libby',
  'sonia', 'aria', 'jenny', 'emma', 'ava', 'zoe', 'female', 'woman',
]);
const MALE_NAMES = new Set([
  'prabhat', 'madhur', 'मधुर', 'niranjan', 'નિરંજન', 'rishi', 'hemant', 'ravi', 'neel', 'aarav', 'david', 'mark', 'daniel',
  'alex', 'tom', 'fred', 'george', 'guy', 'ryan', 'william', 'malcolm', 'oliver', 'male', 'man',
]);

function genderRank({ name, identifier }: VoiceInfo): number {
  const words = `${name} ${identifier}`.toLowerCase().split(/[\s().,_/–-]+/).filter(Boolean);
  if (words.some((w) => FEMALE_NAMES.has(w))) return 0;
  if (words.some((w) => MALE_NAMES.has(w))) return 2;
  return 1;
}

const normLanguage = (tag: string): string => String(tag ?? '').trim().replace(/_/g, '-').toLowerCase();

/** Android's Google voices: "hi-in-x-hia-local", "en-in-x-ene-network". */
const GOOGLE_ANDROID = /^[a-z]{2,3}-[a-z]{2}-x-[a-z0-9]+-(?:local|network)$/i;

/**
 * How much like a person a voice sounds: 0 the best kind (the iPhone's Premium and Enhanced voices, Android's Google
 * voices, Edge's "Online (Natural)" and other natural or neural voices, the browsers' online Google voices), 1 any
 * other voice, 2 a robotic one (the iPhone's Eloquence and novelty voices, eSpeak). Then, within the best kind:
 * Premium, Enhanced, natural or neural by name, Google's.
 */
function voiceKind(voice: VoiceInfo): [kind: number, within: number] {
  const said = `${voice.identifier} ${voice.name}`;
  if (/eloquence|speech\.synthesis\.voice|espeak/i.test(said)) return [2, 0];
  if (/\.premium\.|\bpremium\b/i.test(said)) return [0, 0];
  if (voice.quality === 'Enhanced' || /\.enhanced\./i.test(voice.identifier)) return [0, 1];
  if (/natural|neural|wavenet|\bonline\b/i.test(said)) return [0, 2];
  if (/google/i.test(voice.name) || GOOGLE_ANDROID.test(voice.identifier)) return [0, 3];
  return [1, 0];
}

/** For English: Indian English first, then British, then American, then any other English. */
function englishLocaleRank(tag: string): number {
  const l = normLanguage(tag);
  if (l === 'en-in') return 0;
  if (l === 'en-gb') return 1;
  if (l === 'en-us') return 2;
  return 3;
}

/**
 * The best voice of `voices` for `language`, or null when the device has none of that language. How human it sounds
 * comes first, then (for English) the Indian accent, then the finer kind, a woman's voice, a voice on the device
 * before one over the internet (Android's "-local" before "-network": it works without the internet and starts at
 * once), and last its identifier, so the same device always chooses the same voice. The order the device lists
 * voices in never decides. Gujarati and Hindi are only ever a voice of their own language.
 */
export function chooseVoice<V extends VoiceInfo>(voices: readonly V[], language: SpeechLanguage): V | null {
  const want = SPEECH_TAGS[language].toLowerCase();
  const rankOf = (voice: V): number[] => {
    const [kind, within] = voiceKind(voice);
    const locale = language === 'en' ? englishLocaleRank(voice.language) : normLanguage(voice.language) === want ? 0 : 1;
    const network = /-network$/i.test(voice.identifier) ? 1 : 0;
    return [kind, locale, within, genderRank(voice), network];
  };
  const better = (a: V, b: V): boolean => {
    const ra = rankOf(a);
    const rb = rankOf(b);
    const differs = ra.findIndex((value, i) => value !== rb[i]);
    return differs >= 0 ? ra[differs]! < rb[differs]! : a.identifier < b.identifier;
  };
  let best: V | null = null;
  for (const voice of voices) {
    if (normLanguage(voice.language).split('-')[0] !== language) continue;
    if (best === null || better(voice, best)) best = voice;
  }
  return best;
}

// ── What to say, and with which voice ────────────────────────────────────────────────────────────

export interface SpokenPiece {
  text: string;
  language: SpeechLanguage;
  /** The language tag it is spoken with: en-IN, gu-IN or hi-IN. */
  tag: string;
  /** The identifier of the voice that says it, or null for the engine's own voice for the tag. */
  voice: string | null;
}

export interface SpeechPlan {
  pieces: SpokenPiece[];
  /** Languages the reply has words in that no voice on the device speaks: those words are shown, not said. */
  unspoken: SpeechLanguage[];
}

/**
 * How a reply is said: its parts in order, each made for the ear and cut into pieces, each with the best voice for its
 * language. `voices` is the device's voices, or null when they could not be listed: then each part is given to the
 * engine with its language tag, to say with its own voice for it. A Gujarati or Hindi part with no voice of its
 * language on a device whose voices are known is not said at all (another language's voice can't read it), and is
 * named in `unspoken`.
 */
export function planSpeech(markdown: string, voices: readonly VoiceInfo[] | null, maxChars: number, now: Date = new Date()): SpeechPlan {
  const pieces: SpokenPiece[] = [];
  const unspoken = new Set<SpeechLanguage>();
  const known = voices !== null && voices.length > 0 ? voices : null;
  for (const segment of voiceSegments(markdown)) {
    const { language } = segment;
    const voice = known ? chooseVoice(known, language) : null;
    if (known && !voice && language !== 'en') {
      unspoken.add(language);
      continue;
    }
    const text = forTheEar(segment.text, language, now);
    for (const piece of speechPieces(text, maxChars)) {
      pieces.push({ text: piece, language, tag: SPEECH_TAGS[language], voice: voice?.identifier ?? null });
    }
  }
  return { pieces, unspoken: [...unspoken] };
}

/**
 * The rest of a reading after a voice failed to speak (on Android, a voice listed before its data is on the phone; an
 * online voice with no internet): each piece a voice in `failed` was to say goes to the next best voice of its language.
 * With none of its language left, an English piece goes to the engine's own voice, and a Gujarati or Hindi piece is
 * left out and named in `unspoken`, as planSpeech does: another language's voice can't read it.
 */
export function replan(pieces: readonly SpokenPiece[], voices: readonly VoiceInfo[] | null, failed: ReadonlySet<string>): SpeechPlan {
  const usable = voices ? voices.filter((voice) => !failed.has(voice.identifier)) : [];
  const out: SpokenPiece[] = [];
  const unspoken = new Set<SpeechLanguage>();
  for (const piece of pieces) {
    if (piece.voice === null || !failed.has(piece.voice)) {
      out.push(piece);
      continue;
    }
    const voice = chooseVoice(usable, piece.language);
    if (voice) out.push({ ...piece, voice: voice.identifier });
    else if (piece.language === 'en') out.push({ ...piece, voice: null });
    else unspoken.add(piece.language);
  }
  return { pieces: out, unspoken: [...unspoken] };
}
