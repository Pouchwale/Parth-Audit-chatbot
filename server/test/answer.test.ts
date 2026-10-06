// A spoken or typed yes or no to a waiting confirmation card (mobile/src/lib/answer.ts), in English, Gujarati and Hindi,
// each in its own script or in Latin letters. The app has no test runner of its own, and this is a plain function, so it
// is checked here with the server's tests.
import { expect, it } from 'vitest';

// Loaded by a path the server's typecheck does not follow: the app's files are the app's typecheck's.
interface AnswerModule {
  answerTo(text: string): 'confirm' | 'cancel' | null;
}
const APP_MODULE: string = new URL('../../mobile/src/lib/answer.ts', import.meta.url).href;
const { answerTo } = (await import(APP_MODULE)) as AnswerModule;

it('hears yes and no in English as before', () => {
  for (const yes of ['yes', 'Yes.', 'OK', 'okay, go ahead', 'Confirm', 'yes please', 'sure thanks', 'Do it!']) expect(answerTo(yes), yes).toBe('confirm');
  for (const no of ['no', 'No!', 'cancel', "don't", 'do not', 'never mind', 'Stop.', 'no thank you']) expect(answerTo(no), no).toBe('cancel');
});

it('hears yes and no in Gujarati and Hindi, in their own scripts and in Latin letters', () => {
  for (const yes of ['હા', 'હા.', 'હા જી', 'હા, કરી દો', 'ઠીક છે', 'બરાબર', 'ha', 'Haa', 'thik che', 'barabar', 'kari do']) expect(answerTo(yes), yes).toBe('confirm');
  for (const yes of ['हाँ', 'हां', 'हाँ जी', 'जी हाँ', 'ठीक है।', 'हाँ, कर दो', 'haan', 'haan ji', 'theek hai', 'ok kar do', 'कन्फर्म करो']) expect(answerTo(yes), yes).toBe('confirm');
  for (const no of ['ના', 'ના.', 'નહીં', 'રહેવા દો', 'રદ કરો', 'na', 'rehva do', 'na karo']) expect(answerTo(no), no).toBe('cancel');
  for (const no of ['नहीं', 'नहीं।', 'ना', 'रहने दो', 'मत करो', 'कैंसल करो', 'nahi', 'nahin', 'mat karo', 'rehne do']) expect(answerTo(no), no).toBe('cancel');
});

it('takes anything more than a plain yes or no, or words that could mean either, as a new request', () => {
  for (const request of [
    'okay, close item 13 instead',
    'હા, પણ F-101 નહીં',
    'हाँ लेकिन कल का',
    'yes no',
    'band karo',
    'बंद करो',
    'ji',
    'chalo',
    'aaje nu record kholo',
    '',
    '...',
  ]) {
    expect(answerTo(request), request).toBeNull();
  }
});
