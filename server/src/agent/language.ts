import type { ReplyLanguage } from '@shared/api.ts';

// THE LANGUAGE OF A CONVERSATION. People at the plant write English, Gujarati and Hindi: each in its own script, and
// Gujarati and Hindi in Latin letters too ("aaje nu record kholo", "aaj ka record kholo"), often mixed with English
// names. Mitra answers in the language and script of the person's latest message (the rule in prompt.ts), or always in
// the one they chose in the app's settings (ReplyLanguage in shared/api.ts). The model reads most of this itself. The
// server adds what it can tell for sure from the words, in the note that follows the standing instructions (so the
// start of every request stays the same for everyone), and says its own few fixed sentences in the same language.

/** The three languages people use with Mitra. */
export type Language = 'en' | 'gu' | 'hi';

/** The values a request's replyLanguage can take. */
export const REPLY_LANGUAGES = ['auto', 'en', 'gu', 'hi'] as const satisfies readonly ReplyLanguage[];

/** What a message is written in. */
export interface Written {
  language: Language;
  /** Gujarati or Hindi written in Latin letters. Always false for English. */
  romanized: boolean;
}

/** What the request a turn answers is written in, or for a bare yes or no, the conversation before it. */
export interface TurnLanguage {
  written: Written;
  /** Read from an earlier message, because the latest one has no language of its own. */
  earlier: boolean;
}

const WORDS = /[\p{L}\p{M}]+/gu;
const GUJARATI = /\p{Script=Gujarati}/u;
const DEVANAGARI = /\p{Script=Devanagari}/u;

// The everyday little words of a Gujarati or a Hindi sentence: one of them marks the sentence as that language even
// when most of its words are English names ("Line Clearance Checklist ભરો"). The app tells which voice reads a reply
// by the same words (mobile/src/lib/speech-voice.ts): keep the two lists alike.
const GUJARATI_GRAMMAR = new Set([
  'છે', 'છો', 'છું', 'અને', 'માં', 'નું', 'ની', 'નો', 'ના', 'ને', 'થી', 'પર', 'માટે', 'એટલે', 'કે', 'પણ', 'તો', 'કરો', 'ભરો',
  'હતું', 'હતી', 'હશે', 'નથી', 'શું', 'કયું', 'કયો', 'કેટલા', 'ક્યારે', 'આજે', 'બાકી', 'પછી', 'પહેલાં', 'તેનું', 'આ', 'એ',
]);
const HINDI_GRAMMAR = new Set([
  'है', 'हैं', 'और', 'में', 'का', 'की', 'के', 'को', 'से', 'पर', 'लिए', 'यानी', 'मतलब', 'भी', 'तो', 'करें', 'भरें', 'था', 'थी',
  'नहीं', 'क्या', 'कौन', 'कितने', 'कब', 'आज', 'बाकी', 'बाद', 'पहले', 'इसका', 'यह', 'वह',
]);

// Gujarati and Hindi in Latin letters: words that belong to one of them and are not English words ("main", "din",
// "mate" and "have" are English too, so they are not here). A message needs two of them, and more of its own
// language's than of the other's. Words both languages share ("kholo", "karo", "baki") decide nothing.
const HINDI_LATIN = new Set([
  'hai', 'hain', 'kya', 'kaise', 'kaisa', 'kaisi', 'kitna', 'kitne', 'kitni', 'mujhe', 'mera', 'meri', 'mere', 'aaj', 'kal',
  'ka', 'ki', 'mein', 'nahi', 'nahin', 'kab', 'kahan', 'kaun', 'kyun', 'kyon', 'dikhao', 'dikhaiye', 'batao', 'bataiye',
  'chahiye', 'karna', 'karni', 'kariye', 'kijiye', 'hoga', 'hogi', 'tha', 'thi', 'raha', 'rahi', 'rahe', 'wala', 'wali',
  'abhi', 'sabhi', 'bhi', 'aur', 'iska', 'uska', 'dijiye', 'sakte', 'sakta', 'sakti', 'liye',
]);
const GUJARATI_LATIN = new Set([
  'che', 'chhe', 'chho', 'cho', 'chu', 'chhu', 'nu', 'nathi', 'maru', 'mari', 'mara', 'mane', 'tame', 'tamaru', 'tamari',
  'tamne', 'shu', 'kem', 'kyare', 'aaje', 'kale', 'ketla', 'ketli', 'ketlu', 'batavo', 'bataavo', 'joie', 'joiye', 'karvanu',
  'bharvanu', 'kholvanu', 'hatu', 'hati', 'hata', 'ane', 'etle', 'kayu', 'sathe', 'haju', 'aapo', 'aapjo', 'jovu', 'juo',
]);

/** A message with no language of its own, in Latin letters: yes, no, okay, thanks, an answer to a card. */
const BARE_REPLY =
  /^(?:yes|yeah|yep|yup|no|nope|ok|okay|sure|done|confirm|cancel|stop|go ahead|do it|ha+|haa+n|han|haan\s?ji|ji|ji\s?haan|nahi|nahin|na+|nai|hmm+|thik|theek|thik\s+che|theek\s+hai|thanks?|thank\s+you|thx)[\s.!?]*$/i;

/** Codes are nobody's language: F/QC/30, F-QC-40.C, M-47, FGSL3877, a record's id, a date. */
const CODES = /\b[A-Za-z]{1,4}\s?[/-]\s?[A-Za-z0-9]+(?:[/.-][A-Za-z0-9]+)*\b|\b[\w-]*\d[\w-]*\b/g;

/**
 * What a message is written in: Gujarati or Hindi when a third or more of its words are in that script, or one of its
 * little grammar words is; Gujarati or Hindi in Latin letters by their everyday words; else English. Null when it has
 * no language of its own, such as a bare yes or no, or only a format number.
 */
export function writtenIn(text: string): Written | null {
  const raw = text.trim();
  if (!raw) return null;
  const words = raw.match(WORDS) ?? [];
  let gu = 0;
  let hi = 0;
  for (const word of words) {
    if (GUJARATI.test(word)) gu++;
    else if (DEVANAGARI.test(word)) hi++;
  }
  if (gu + hi > 0) {
    const grammar = words.some((word) => GUJARATI_GRAMMAR.has(word) || HINDI_GRAMMAR.has(word));
    if (grammar || (gu + hi) / words.length >= 0.3) return { language: gu >= hi ? 'gu' : 'hi', romanized: false };
  }
  if (BARE_REPLY.test(raw)) return null;
  const latin = raw.replace(CODES, ' ').toLowerCase().match(/[a-z]{2,}/g) ?? [];
  if (latin.length === 0) return null;
  let hiWords = 0;
  let guWords = 0;
  for (const word of new Set(latin)) {
    if (HINDI_LATIN.has(word)) hiWords++;
    if (GUJARATI_LATIN.has(word)) guWords++;
  }
  if (hiWords >= 2 && hiWords > guWords) return { language: 'hi', romanized: true };
  if (guWords >= 2 && guWords > hiWords) return { language: 'gu', romanized: true };
  return { language: 'en', romanized: false };
}

/**
 * What a turn answers in, as far as the words tell: the request's own language, or when it has none (a bare yes or
 * no), that of the person's latest earlier message that has one. `earlier` is their messages, newest first.
 */
export function turnLanguage(request: string, earlier: readonly string[] = []): TurnLanguage | null {
  const own = writtenIn(request);
  if (own) return { written: own, earlier: false };
  for (const text of earlier) {
    const written = writtenIn(text);
    if (written) return { written, earlier: true };
  }
  return null;
}

type Voice = 'en' | 'gu' | 'gu-latin' | 'hi' | 'hi-latin';

function voiceOf({ language, romanized }: Written): Voice {
  if (language === 'en') return 'en';
  return romanized ? `${language}-latin` : language;
}

const NAMES: Record<Voice, string> = {
  en: 'English',
  gu: 'Gujarati, in Gujarati script',
  'gu-latin': 'Gujarati, in Latin letters',
  hi: 'Hindi, in Devanagari',
  'hi-latin': 'Hindi, in Latin letters',
};

/**
 * The line about the reply's language in the note that follows the standing instructions: the person's choice in the
 * app's settings, or what their message is written in when that is Gujarati or Hindi. English needs no line: the
 * standing rule answers it.
 */
export function languageNote(choice: ReplyLanguage | undefined, found: TurnLanguage | null): string | null {
  if (choice === 'en' || choice === 'gu' || choice === 'hi') {
    return `Reply language, chosen in the app's settings: ${NAMES[choice]}, whatever language they write in.`;
  }
  if (!found || found.written.language === 'en') return null;
  const name = NAMES[voiceOf(found.written)];
  return `${found.earlier ? 'This conversation is' : 'Their latest message is'} in ${name}: answer in ${name}.`;
}

/** The sentences the server says itself rather than the model. */
export type FixedReply = 'cancelled' | 'expired' | 'unclear' | 'unfinished';

const FIXED: Record<FixedReply, Record<Voice, string>> = {
  cancelled: {
    en: "Okay, I didn't change anything.",
    gu: 'ઠીક છે, મેં કંઈ બદલ્યું નથી.',
    'gu-latin': 'Thik che, me kai badlyu nathi.',
    hi: 'ठीक है, मैंने कुछ नहीं बदला।',
    'hi-latin': 'Theek hai, maine kuch nahi badla.',
  },
  expired: {
    en: "That request expired, so I didn't change anything. Ask me again if you still want it.",
    gu: 'એ વિનંતીનો સમય પૂરો થઈ ગયો, એટલે મેં કંઈ બદલ્યું નથી. હજુ જોઈતું હોય તો ફરીથી કહો.',
    'gu-latin': 'E vinanti no samay puro thai gayo, etle me kai badlyu nathi. Haju joitu hoy to farithi kaho.',
    hi: 'उस अनुरोध का समय निकल गया, इसलिए मैंने कुछ नहीं बदला। अगर अब भी चाहिए, तो फिर से कहिए।',
    'hi-latin': 'Us request ka samay nikal gaya, isliye maine kuch nahi badla. Agar ab bhi chahiye, to phir se kahiye.',
  },
  unclear: {
    en: "Sorry, I couldn't work that out. Could you say it more simply?",
    gu: 'માફ કરજો, એ સમજાયું નહીં. થોડું સરળ રીતે કહેશો?',
    'gu-latin': 'Maaf karjo, e samjayu nahi. Thodu saral rite kahesho?',
    hi: 'माफ़ कीजिए, यह समझ नहीं आया। थोड़ा आसान करके कहेंगे?',
    'hi-latin': 'Maaf kijiye, yeh samajh nahi aaya. Thoda aasaan karke kahenge?',
  },
  unfinished: {
    en: "Sorry, I couldn't finish that. Could you try it in smaller steps?",
    gu: 'માફ કરજો, એ પૂરું ન થઈ શક્યું. નાના નાના ભાગમાં કહેશો?',
    'gu-latin': 'Maaf karjo, e puru na thai shakyu. Nana nana bhag ma kahesho?',
    hi: 'माफ़ कीजिए, यह पूरा नहीं हो पाया। छोटे-छोटे हिस्सों में कहेंगे?',
    'hi-latin': 'Maaf kijiye, yeh poora nahi ho paaya. Chhote-chhote hisson mein kahenge?',
  },
};

/** One of the server's own sentences, in the person's chosen reply language, else in the language they wrote in. */
export function fixedReply(key: FixedReply, choice: ReplyLanguage | undefined, found: TurnLanguage | null): string {
  if (choice === 'en' || choice === 'gu' || choice === 'hi') return FIXED[key][choice];
  return FIXED[key][found ? voiceOf(found.written) : 'en'];
}
