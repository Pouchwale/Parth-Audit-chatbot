// A SPOKEN OR TYPED ANSWER TO A WAITING CONFIRMATION: yes or no, in English, Gujarati or Hindi, each in its own script
// or in Latin letters ("ha", "haan ji", "nahi"), as people at the plant say them. Plain functions with no imports, so
// the server's tests can check them (server/test/answer.test.ts).
//
// Only a short, plain yes or no counts: "okay, close item 13 instead" is a new request, which drops the waiting change.
// Words that could mean either are left out: "band karo" ("close it", or "stop"), a bare "ji" ("yes", or "pardon?"),
// "chalo" ("go ahead", or "never mind"). Said any other way, the answer goes to Mitra as a message.

/** The ways of saying yes, each a word or a few words. */
const YES = [
  // English
  'yes', 'yeah', 'yep', 'yup', 'ok', 'okay', 'sure', 'confirm', 'confirmed', 'go ahead', 'do it', 'proceed',
  // Gujarati, in its own script and in Latin letters
  'હા', 'હાં', 'હા જી', 'હાજી', 'બરાબર', 'ઠીક છે', 'કરો', 'કરી દો', 'ઓકે', 'કન્ફર્મ', 'કન્ફર્મ કરો',
  'ha', 'haa', 'ha ji', 'haji', 'barabar', 'thik che', 'theek che', 'thik chhe', 'karo', 'kari do', 'confirm karo',
  // Hindi, in Devanagari and in Latin letters
  'हाँ', 'हां', 'हा', 'हाँ जी', 'हां जी', 'जी हाँ', 'जी हां', 'ठीक है', 'करो', 'कर दो', 'कीजिए', 'ओके', 'कन्फर्म', 'कन्फर्म करो',
  'haan', 'han', 'haan ji', 'ji haan', 'theek hai', 'thik hai', 'kar do', 'kijiye',
];

/** The ways of saying no. */
const NO = [
  // English
  'no', 'nope', 'cancel', 'stop', "don't", 'do not', 'never mind', 'nevermind',
  // Gujarati
  'ના', 'નહીં', 'નહિ', 'ના જી', 'રહેવા દો', 'રદ કરો', 'કેન્સલ', 'કેન્સલ કરો', 'ના કરો', 'ના કરશો',
  'na', 'naa', 'nai', 'rehva do', 'raheva do', 'rad karo', 'na karo', 'na karsho', 'cancel karo',
  // Hindi
  'नहीं', 'नही', 'ना', 'न', 'नहीं जी', 'रहने दो', 'रद्द करो', 'रद करो', 'कैंसल', 'कैंसल करो', 'मत करो', 'न करो',
  'nahi', 'nahin', 'nahi ji', 'rehne do', 'rahne do', 'radd karo', 'mat karo',
];

/** Said around an answer without changing it. */
const POLITE = new Set(['please', 'plz', 'pls', 'thanks', 'thank', 'you', 'પ્લીઝ', 'આભાર', 'प्लीज़', 'प्लीज', 'कृपया', 'धन्यवाद']);

/** The longest answer, in words, that is still a plain yes or no rather than a request. */
const MOST_WORDS = 8;

/** The words of what was said: lower case, each of any script, without punctuation (the danda too) or figures. */
function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    // The invisible joiners some keyboards put inside Gujarati and Hindi words.
    .replace(/[\u200c\u200d]/g, '')
    .replace(/[^\p{L}\p{M}' ]+/gu, ' ')
    .split(' ')
    .filter((word) => word && !POLITE.has(word));
}

const phrases = (list: readonly string[]): ReadonlySet<string> => new Set(list.map((phrase) => words(phrase).join(' ')));
const YES_PHRASES = phrases(YES);
const NO_PHRASES = phrases(NO);

/** Whether the words are nothing but ways of saying one thing ("yes", "ok, go ahead", "હા, કરી દો"). */
function onlyPhrasesOf(said: readonly string[], known: ReadonlySet<string>): boolean {
  // reachable[i]: the first i words are known phrases, one after another.
  const reachable = [true, ...said.map(() => false)];
  for (let start = 0; start < said.length; start++) {
    if (!reachable[start]) continue;
    for (let end = start + 1; end <= Math.min(said.length, start + 3); end++) {
      if (known.has(said.slice(start, end).join(' '))) reachable[end] = true;
    }
  }
  return reachable[said.length] === true;
}

/** Reads a spoken or typed answer to a waiting confirmation: confirm, cancel, or null when it is not a plain yes or no. */
export function answerTo(text: string): 'confirm' | 'cancel' | null {
  const said = words(text);
  if (said.length === 0 || said.length > MOST_WORDS) return null;
  if (onlyPhrasesOf(said, YES_PHRASES)) return 'confirm';
  if (onlyPhrasesOf(said, NO_PHRASES)) return 'cancel';
  return null;
}
