// How the phone app reads replies aloud (mobile/src/lib/speech-voice.ts): the language from the script, the voice the
// device has for it, and the text made for the ear. The app has no test runner of its own, and these are plain
// functions, so they are checked here with the server's tests, over the kinds of voice lists phones and browsers give.
import { describe, expect, it } from 'vitest';

type SpeechLanguage = 'en' | 'gu' | 'hi';
interface VoiceInfo {
  identifier: string;
  name: string;
  quality: string;
  language: string;
}
interface SpokenPiece {
  text: string;
  language: SpeechLanguage;
  tag: string;
  voice: string | null;
}
// Loaded by a path the server's typecheck does not follow: the app's files are the app's typecheck's.
interface SpeechVoiceModule {
  SPEECH_TAGS: Record<SpeechLanguage, string>;
  PROSODY: { rate: number; pitch: number };
  sentenceLanguage(sentence: string): SpeechLanguage | null;
  mainLanguage(text: string): SpeechLanguage | null;
  voiceSegments(text: string): { language: SpeechLanguage; text: string }[];
  forTheEar(text: string, language: SpeechLanguage, now?: Date): string;
  speechPieces(text: string, maxChars: number): string[];
  chooseVoice(voices: readonly VoiceInfo[], language: SpeechLanguage): VoiceInfo | null;
  planSpeech(markdown: string, voices: readonly VoiceInfo[] | null, maxChars: number, now?: Date): { pieces: SpokenPiece[]; unspoken: SpeechLanguage[] };
  replan(pieces: readonly SpokenPiece[], voices: readonly VoiceInfo[] | null, failed: ReadonlySet<string>): { pieces: SpokenPiece[]; unspoken: SpeechLanguage[] };
}
const APP_MODULE: string = new URL('../../mobile/src/lib/speech-voice.ts', import.meta.url).href;
const { SPEECH_TAGS, PROSODY, sentenceLanguage, mainLanguage, voiceSegments, forTheEar, speechPieces, chooseVoice, planSpeech, replan } = (await import(
  APP_MODULE
)) as SpeechVoiceModule;
interface Reply {
  reply: string;
  confirmation: { changes: { system: string; summary: string }[] } | null;
}
const { spokenReply } = (await import(new URL('../../mobile/src/lib/transcript.ts', import.meta.url).href)) as {
  spokenReply(reply: Reply, asked?: SpeechLanguage | null): string;
};

const NOW = new Date('2026-10-06T06:00:00Z');
const voice = (identifier: string, language: string, quality = 'Default', name = identifier): VoiceInfo => ({ identifier, name, quality, language });

// What an iPhone lists: compact voices, the Enhanced and Premium ones a person downloaded (expo-speech calls only the
// Enhanced ones "Enhanced"), and the robotic Eloquence and novelty voices.
const IPHONE = [
  voice('com.apple.voice.compact.en-US.Samantha', 'en-US', 'Default', 'Samantha'),
  voice('com.apple.eloquence.en-US.Eddy', 'en-US', 'Default', 'Eddy'),
  voice('com.apple.speech.synthesis.voice.Fred', 'en-US', 'Default', 'Fred'),
  voice('com.apple.voice.compact.en-IN.Rishi', 'en-IN', 'Default', 'Rishi'),
  voice('com.apple.voice.premium.en-GB.Malcolm', 'en-GB', 'Default', 'Malcolm (Premium)'),
  voice('com.apple.voice.enhanced.en-IN.Isha', 'en-IN', 'Enhanced', 'Isha (Enhanced)'),
  voice('com.apple.voice.compact.hi-IN.Lekha', 'hi-IN', 'Default', 'Lekha'),
];
// What an Android phone with Google's speech engine lists: Google's voices on the phone and over the internet, and a
// language's plain default.
const ANDROID = [
  voice('en-us-x-sfg-local', 'en-US', 'Enhanced'),
  voice('en-in-x-ena-network', 'en-IN', 'Enhanced'),
  voice('en-in-x-end-local', 'en-IN', 'Enhanced'),
  voice('en-in-x-ene-local', 'en-IN', 'Enhanced'),
  voice('hi-in-x-hid-network', 'hi-IN', 'Enhanced'),
  voice('hi-in-x-hia-local', 'hi-IN', 'Enhanced'),
  voice('gu-IN-language', 'gu-IN', 'Default'),
  voice('gu-in-x-guf-network', 'gu-IN', 'Enhanced'),
  voice('gu-in-x-gua-local', 'gu-IN', 'Enhanced'),
];
// What Microsoft Edge lists on Windows: its desktop voices and its natural ones from Microsoft's service.
const EDGE = [
  voice('Microsoft Heera - English (India)', 'en-IN', 'Default'),
  voice('Microsoft Prabhat Online (Natural) - English (India)', 'en-IN'),
  voice('Microsoft Neerja Online (Natural) - English (India)', 'en-IN'),
  voice('Microsoft Madhur Online (Natural) - Hindi (India)', 'hi-IN'),
  voice('Microsoft Swara Online (Natural) - Hindi (India)', 'hi-IN'),
  voice('Microsoft Niranjan Online (Natural) - Gujarati (India)', 'gu-IN'),
  voice('Microsoft Dhwani Online (Natural) - Gujarati (India)', 'gu-IN'),
];
// What Chrome lists on Windows: the desktop voices and Google's online ones; no Gujarati voice at all.
const CHROME = [
  voice('Microsoft Heera - English (India)', 'en-IN'),
  voice('Microsoft Kalpana - Hindi (India)', 'hi-IN'),
  voice('Google US English', 'en-US'),
  voice('Google UK English Female', 'en-GB'),
  voice('Google हिन्दी', 'hi-IN'),
];

describe('the language of what is said', () => {
  it('tells it from the script: Gujarati, Devanagari, else English', () => {
    expect(sentenceLanguage('આજે F/QC/30 બાકી છે.')).toBe('gu');
    expect(sentenceLanguage('Line Clearance Checklist ભરો.')).toBe('gu');
    expect(sentenceLanguage('आज F/HR/17 बाकी है।')).toBe('hi');
    expect(sentenceLanguage('Done. Finding 12 is now closed.')).toBe('en');
    expect(sentenceLanguage('Aaje nu record kholo.')).toBe('en');
    expect(sentenceLanguage('92%')).toBeNull();
    expect(mainLanguage('થઈ ગયું. **F-QC-30** નો રેકોર્ડ ખુલ્લો છે.')).toBe('gu');
    expect(mainLanguage('')).toBeNull();
  });

  it('says a mixed reply part by part, keeping an English name inside a Gujarati answer with the Gujarati voice', () => {
    expect(voiceSegments('F/HR/05 એટલે Induction Training Record. કાલે ભરવાનું છે.\n\nPlease confirm: Fill today\'s record of F-QC-30 with sample data. Say confirm or cancel.')).toEqual([
      { language: 'gu', text: 'F/HR/05 એટલે Induction Training Record. કાલે ભરવાનું છે.' },
      { language: 'en', text: "Please confirm: Fill today's record of F-QC-30 with sample data. Say confirm or cancel." },
    ]);
    expect(voiceSegments('आज का रिकॉर्ड खुला है। Done.')).toEqual([
      { language: 'hi', text: 'आज का रिकॉर्ड खुला है।' },
      { language: 'en', text: 'Done.' },
    ]);
  });
});

describe('text made for the ear', () => {
  it('drops the markdown, reads format numbers letter by letter, and pauses after each item of a list', () => {
    expect(forTheEar("Done. Today's **F/QC/30** record is open:\n- Hour **10:00** checked\n- `F-QC-30` saved", 'en', NOW)).toBe(
      "Done. Today's F Q C 30 record is open: Hour 10 AM checked. F Q C 30 saved.",
    );
    expect(forTheEar('# Heading\n> quoted\n1. first\n2. second', 'en', NOW)).toBe('Heading. quoted. first. second.');
  });

  it('says dates as a person does in each language, and the year only when it is not this one', () => {
    expect(forTheEar('Due on 2026-10-06, last done 30-Sep-2025.', 'en', NOW)).toBe('Due on 6th October, last done 30th September 2025.');
    expect(forTheEar('2026-10-06 એ બાકી છે.', 'gu', NOW)).toBe('6 ઓક્ટોબર એ બાકી છે.');
    expect(forTheEar('2026-10-06 को बाकी है', 'hi', NOW)).toBe('6 अक्टूबर को बाकी है।');
    expect(forTheEar('92% done, 25°C, ₹1,200.', 'en', NOW)).toBe('92 percent done, 25 degrees Celsius, 1,200 rupees.');
    expect(forTheEar('92% થયું.', 'gu', NOW)).toBe('92 ટકા થયું.');
  });

  it("leaves a record's long id out instead of spelling it, and never reads Gujarati letters to an English voice", () => {
    expect(forTheEar('Opened record **rec-mg8x9k2a-1f-abc123** for today.', 'en', NOW)).toBe('Opened record for today.');
    expect(forTheEar('The record (id 3f2a9c1e-77b2-4c1d-9e0f-5a6b7c8d9e0f) is open.', 'en', NOW)).toBe('The record is open.');
    // A lot number is no record id: it is said, its letters one by one, and its figures are no range.
    expect(forTheEar('Lot LOT-2026-0915-A is fine.', 'en', NOW)).toBe('Lot L O T 2026-0915-A is fine.');
    expect(forTheEar('Keep it at 10-20 mm.', 'en', NOW)).toBe('Keep it at 10 to 20 millimetres.');
    expect(forTheEar('Ask વિજય about it.', 'en', NOW)).toBe('Ask about it.');
    expect(forTheEar('```json\n{"a": 1}\n```', 'en', NOW)).toBe('Code block omitted.');
  });

  it('cuts a reply into pieces at sentence ends, the danda too, none longer than asked', () => {
    expect(speechPieces('One. Two! Three?', 10)).toEqual(['One. Two!', 'Three?']);
    expect(speechPieces('पहला वाक्य। दूसरा वाक्य।', 12)).toEqual(['पहला वाक्य।', 'दूसरा वाक्य।']);
    const long = Array.from({ length: 40 }, (_, i) => `Item ${i} is checked, signed and filed.`).join(' ');
    const pieces = speechPieces(long, 220);
    expect(pieces.every((piece) => piece.length <= 220)).toBe(true);
    expect(pieces.join(' ')).toBe(long);
    expect(speechPieces(`${'word '.repeat(80)}end.`, 100).every((piece) => piece.length <= 100)).toBe(true);
  });
});

describe("a card's question", () => {
  const card = (reply: string): Reply => ({
    reply,
    confirmation: {
      changes: [
        { system: 'DCRS', summary: "Open today's record of F-QC-30" },
        { system: 'DCRS', summary: "Fill today's record of F-QC-30 with sample data" },
      ],
    },
  });

  it("is asked in the reply's language, or the one the request was in, and said by one voice", () => {
    expect(spokenReply(card('I can do that.'))).toBe(
      "I can do that.\n\nPlease confirm: Open today's record of F-QC-30. Fill today's record of F-QC-30 with sample data. Say confirm or cancel.",
    );
    const gujarati = spokenReply(card(''), 'gu');
    expect(gujarati).toBe("કૃપા કરીને કન્ફર્મ કરો: Open today's record of F-QC-30; Fill today's record of F-QC-30 with sample data. હા કે ના કહો.");
    // The English descriptions stay in the Gujarati sentence that asks about them: one voice says it all.
    expect(voiceSegments(gujarati).map((segment) => segment.language)).toEqual(['gu']);
    expect(spokenReply(card('ठीक है, मैं यह कर सकता हूँ।'))).toMatch(/^ठीक है, मैं यह कर सकता हूँ।\n\nकृपया कन्फर्म करें: .+। हाँ या ना कहिए।$/);
    expect(spokenReply({ reply: 'Done.', confirmation: null }, 'gu')).toBe('Done.');
  });
});

describe('the voice', () => {
  it('speaks Indian English, Gujarati and Hindi, a touch slower than the engines, at the voice\'s own pitch', () => {
    expect(SPEECH_TAGS).toEqual({ en: 'en-IN', gu: 'gu-IN', hi: 'hi-IN' });
    expect(PROSODY).toEqual({ rate: 0.95, pitch: 1 });
  });

  it('on an iPhone: an Enhanced or Premium voice, Indian English before another accent, never a robotic one', () => {
    expect(chooseVoice(IPHONE, 'en')?.identifier).toBe('com.apple.voice.enhanced.en-IN.Isha');
    expect(chooseVoice(IPHONE, 'hi')?.identifier).toBe('com.apple.voice.compact.hi-IN.Lekha');
    expect(chooseVoice(IPHONE, 'gu')).toBeNull();
    // Without the Enhanced Indian voice, how human it sounds comes before the accent.
    const withoutIsha = IPHONE.filter((v) => !v.identifier.includes('Isha'));
    expect(chooseVoice(withoutIsha, 'en')?.identifier).toBe('com.apple.voice.premium.en-GB.Malcolm');
    // Only robotic voices and a compact one: the compact one.
    const plain = IPHONE.filter((v) => /compact\.en-US|eloquence|synthesis/.test(v.identifier));
    expect(chooseVoice(plain, 'en')?.identifier).toBe('com.apple.voice.compact.en-US.Samantha');
  });

  it("on Android: Google's voices of the language, the one on the phone before the one over the internet", () => {
    expect(chooseVoice(ANDROID, 'en')?.identifier).toBe('en-in-x-end-local');
    expect(chooseVoice(ANDROID, 'hi')?.identifier).toBe('hi-in-x-hia-local');
    expect(chooseVoice(ANDROID, 'gu')?.identifier).toBe('gu-in-x-gua-local');
    // The order the phone lists them in never decides.
    expect(chooseVoice([...ANDROID].reverse(), 'gu')?.identifier).toBe('gu-in-x-gua-local');
  });

  it("in a browser: Edge's natural voices, a woman's as DCRS's Mitra has; Chrome's Google voices over its desktop ones", () => {
    expect(chooseVoice(EDGE, 'en')?.name).toBe('Microsoft Neerja Online (Natural) - English (India)');
    expect(chooseVoice(EDGE, 'hi')?.name).toBe('Microsoft Swara Online (Natural) - Hindi (India)');
    expect(chooseVoice(EDGE, 'gu')?.name).toBe('Microsoft Dhwani Online (Natural) - Gujarati (India)');
    expect(chooseVoice(CHROME, 'en')?.name).toBe('Google UK English Female');
    expect(chooseVoice(CHROME, 'hi')?.name).toBe('Google हिन्दी');
    expect(chooseVoice(CHROME, 'gu')).toBeNull();
    // A voice listed with an underscore in its language ("hi_IN") is still Hindi.
    expect(chooseVoice([voice('x', 'hi_IN')], 'hi')?.identifier).toBe('x');
  });

  it('says each part with its own voice, leaves out a Gujarati or Hindi part no voice can say, and uses the engine\'s own voice when the list is unknown', () => {
    const reply = "આજનો **F-QC-30** રેકોર્ડ ખુલ્લો છે.\n\nPlease confirm: Fill today's record of F-QC-30 with sample data. Say confirm or cancel.";
    expect(planSpeech(reply, ANDROID, 600, NOW)).toEqual({
      pieces: [
        { text: 'આજનો F Q C 30 રેકોર્ડ ખુલ્લો છે.', language: 'gu', tag: 'gu-IN', voice: 'gu-in-x-gua-local' },
        { text: "Please confirm: Fill today's record of F Q C 30 with sample data. Say confirm or cancel.", language: 'en', tag: 'en-IN', voice: 'en-in-x-end-local' },
      ],
      unspoken: [],
    });
    // Chrome has no Gujarati voice: the Gujarati is shown and not said, and named so the app can say why.
    expect(planSpeech(reply, CHROME, 220, NOW)).toEqual({
      pieces: [{ text: "Please confirm: Fill today's record of F Q C 30 with sample data. Say confirm or cancel.", language: 'en', tag: 'en-IN', voice: 'Google UK English Female' }],
      unspoken: ['gu'],
    });
    // No list of voices at all: each part goes to the engine with its language, for its own voice of it.
    expect(planSpeech(reply, null, 600, NOW).pieces.map(({ tag, voice: v }) => [tag, v])).toEqual([
      ['gu-IN', null],
      ['en-IN', null],
    ]);
    expect(planSpeech(reply, [], 600, NOW).unspoken).toEqual([]);
  });

  it('gives what a failing voice was to say to the next best voice of its language, never to another language\'s', () => {
    const reply = "આજનો **F-QC-30** રેકોર્ડ ખુલ્લો છે.\n\nPlease confirm: Fill today's record of F-QC-30 with sample data. Say confirm or cancel.";
    const { pieces } = planSpeech(reply, ANDROID, 600, NOW);
    expect(pieces.map((piece) => piece.voice)).toEqual(['gu-in-x-gua-local', 'en-in-x-end-local']);
    // Android listed its Gujarati voice before the voice's data was on the phone: the one over the internet says it.
    expect(replan(pieces, ANDROID, new Set(['gu-in-x-gua-local']))).toEqual({
      pieces: [
        { ...pieces[0], voice: 'gu-in-x-guf-network' },
        { ...pieces[1], voice: 'en-in-x-end-local' },
      ],
      unspoken: [],
    });
    expect(replan(pieces, ANDROID, new Set(['en-in-x-end-local'])).pieces.map((piece) => piece.voice)).toEqual(['gu-in-x-gua-local', 'en-in-x-ene-local']);
    // No Gujarati voice left: the Gujarati is left out and named; with no English voice left, the engine's own says it.
    const every = new Set(ANDROID.map((v) => v.identifier));
    expect(replan(pieces, ANDROID, every)).toEqual({ pieces: [{ ...pieces[1], voice: null }], unspoken: ['gu'] });
    // A piece the engine's own voice was to say, or one whose voice did not fail, is kept as it was.
    const engine = planSpeech(reply, null, 600, NOW).pieces;
    expect(replan(engine, ANDROID, every).pieces).toEqual(engine);
  });
});
