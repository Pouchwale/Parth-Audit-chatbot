// Mitra answers in the language it was asked in: English, Gujarati or Hindi, each in its own script or in Latin letters,
// or always in the one the person chose in the app's settings (replyLanguage). The rule is in the standing
// instructions, the same for everyone; the choice and what the message is written in go in the note that follows.
import { randomUUID } from 'node:crypto';
import type Groq from 'groq-sdk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AssistantReply, ReplyLanguage, TranscriptionResponse } from '@shared/api.ts';
import { languageNote, turnLanguage, writtenIn } from '../src/agent/language.ts';
import { wireMessages } from '../src/agent/model.ts';
import { turnContext } from '../src/agent/prompt.ts';
import { createDcrsConnector } from '../src/connectors/dcrs/index.ts';
import { groqTranscriber, transcriptionPrompt } from '../src/voice/transcriber.ts';
import { callsTool, cutOff, says, setup, testConfig } from './helpers.ts';
import { typicalRequest } from './request-size.ts';

const kapila = { displayName: 'Kapila Barad', username: 'kapila.barad@gpp.local', now: new Date('2026-10-06T06:00:00Z'), timeZone: 'Asia/Kolkata' };

describe('the rule and the note', () => {
  it('tells the model, the same way for everyone, to answer in the language and script it was asked in', () => {
    const { system } = typicalRequest(kapila);
    expect(system).toContain('- Language: people write English, Gujarati or Hindi, each in its own script or in Latin letters');
    expect(system).toContain('"aaje nu record kholo", "aaj ka record kholo"');
    expect(system).toContain('Answer in the language and script of their latest message, unless the app\'s note names one.');
    expect(system).toContain("A bare yes or no, or a tap on a card, keeps the conversation's language.");
    expect(system).toContain('write numbers and dates with the digits 0-9, and format numbers (F/QC/30), record ids, field keys and values exactly as the tools give them');
    expect(system).toContain("a document's name may be followed by its English name in brackets the first time");
  });

  it('puts the reply language in the note after the instructions, so each choice changes only that', () => {
    const request = (replyLanguage?: ReplyLanguage) => typicalRequest({ ...kapila, ...(replyLanguage ? { replyLanguage } : {}) }, [{ role: 'user', content: 'What is due today?' }]);
    const plain = request();
    const choices = { auto: request('auto'), en: request('en'), gu: request('gu'), hi: request('hi') };
    for (const [choice, sent] of Object.entries(choices)) {
      // The start of the request, byte for byte: the instructions, then the tools.
      expect(sent.system, choice).toBe(plain.system);
      expect(JSON.stringify(sent.tools), choice).toBe(JSON.stringify(plain.tools));
      expect(wireMessages(sent)[0], choice).toEqual(wireMessages(plain)[0]);
      expect(sent.messages, choice).toEqual(plain.messages);
    }
    expect(choices.auto.context).toBe(plain.context);
    expect(plain.context).not.toContain('Reply language');
    expect(choices.en.context).toBe(`${plain.context}\nReply language, chosen in the app's settings: English, whatever language they write in.`);
    expect(choices.gu.context).toBe(`${plain.context}\nReply language, chosen in the app's settings: Gujarati, in Gujarati script, whatever language they write in.`);
    expect(choices.hi.context).toBe(`${plain.context}\nReply language, chosen in the app's settings: Hindi, in Devanagari, whatever language they write in.`);
  });

  it('says in the note when the message is in Gujarati or Hindi, in either script, and nothing for English', () => {
    const note = (text: string, earlier: string[] = []) => turnContext({ ...kapila, language: turnLanguage(text, earlier) }).split('\n').at(-1);
    expect(note('આજનો F/QC/30 રેકોર્ડ ખોલો')).toBe('Their latest message is in Gujarati, in Gujarati script: answer in Gujarati, in Gujarati script.');
    expect(note('आज का F/QC/30 रिकॉर्ड खोलो')).toBe('Their latest message is in Hindi, in Devanagari: answer in Hindi, in Devanagari.');
    expect(note('aaje nu record kholo')).toBe('Their latest message is in Gujarati, in Latin letters: answer in Gujarati, in Latin letters.');
    expect(note('aaj ka record kholo')).toBe('Their latest message is in Hindi, in Latin letters: answer in Hindi, in Latin letters.');
    expect(note('Open the F/QC/30 record')).toMatch(/^Today is /);
    // A bare yes or no keeps the conversation's language.
    expect(note('ok', ['aaje shu baki che?', 'What is due today?'])).toBe(
      'This conversation is in Gujarati, in Latin letters: answer in Gujarati, in Latin letters.',
    );
    // The person's choice wins over what they wrote.
    expect(languageNote('en', turnLanguage('આજે શું બાકી છે?'))).toBe("Reply language, chosen in the app's settings: English, whatever language they write in.");
  });

  it('tells the language from the words: the script, the little words of Gujarati and Hindi in Latin letters, not the codes', () => {
    expect(writtenIn('આજે શું બાકી છે?')).toEqual({ language: 'gu', romanized: false });
    expect(writtenIn('Line Clearance Checklist ભરો')).toEqual({ language: 'gu', romanized: false });
    expect(writtenIn('आज क्या बाकी है?')).toEqual({ language: 'hi', romanized: false });
    expect(writtenIn('F/HR/17 का आज का रिकॉर्ड')).toEqual({ language: 'hi', romanized: false });
    expect(writtenIn('aaje shu baki che?')).toEqual({ language: 'gu', romanized: true });
    expect(writtenIn('mujhe aaj ka record dikhao')).toEqual({ language: 'hi', romanized: true });
    expect(writtenIn('What is due today?')).toEqual({ language: 'en', romanized: false });
    expect(writtenIn('Is it a mere formality?')).toEqual({ language: 'en', romanized: false });
    // Nothing to tell from: a bare yes or no, or only a format number.
    for (const bare of ['ok', 'Yes.', 'haan ji', 'nahi', 'thik che', 'F/QC/30', '']) expect(writtenIn(bare), bare).toBeNull();
  });
});

describe('through the server', () => {
  let t: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => {
    t = await setup();
  });
  afterEach(async () => {
    await t.close();
  });

  it('sends the person\'s reply language to the model and refuses a language it does not know', async () => {
    const alice = await t.signIn('alice');
    for (const replyLanguage of ['gu', 'hi', 'en', 'auto'] as const) {
      t.model.queue(says('…'));
      const response = await t.as(alice).post('/assistant/messages', { text: 'What is still open?', replyLanguage });
      expect(response.statusCode, replyLanguage).toBe(200);
    }
    const contexts = t.model.requests.map((request) => request.context ?? '');
    expect(contexts[0]).toContain("Reply language, chosen in the app's settings: Gujarati, in Gujarati script");
    expect(contexts[1]).toContain("Reply language, chosen in the app's settings: Hindi, in Devanagari");
    expect(contexts[2]).toContain("Reply language, chosen in the app's settings: English");
    expect(contexts[3]).not.toContain('Reply language');
    // The same instructions every time.
    expect(new Set(t.model.requests.map((request) => request.system)).size).toBe(1);

    const id = randomUUID();
    const refused = [
      await t.as(alice).post('/assistant/messages', { text: 'What is still open?', replyLanguage: 'fr' }),
      await t.as(alice).post('/assistant/messages', { text: 'What is still open?', replyLanguage: 'Gujarati' }),
      await t.as(alice).post(`/assistant/conversations/${id}/messages/${randomUUID()}/edit`, { text: 'Hello', replyLanguage: 'GU' }),
      await t.as(alice).post(`/assistant/conversations/${id}/decision`, { confirmationId: randomUUID(), decision: 'cancel', replyLanguage: 'hindi' }),
      await t.as(alice).post(`/assistant/conversations/${id}/retry`, { replyLanguage: 1 }),
    ];
    for (const response of refused) {
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: 'invalid_request' });
    }
    expect(t.model.requests).toHaveLength(4);
  });

  it('tells the model what a Gujarati or Hindi message is written in, and keeps it for a bare yes', async () => {
    const alice = await t.signIn('alice');
    t.model.queue(says('હા, બે items ખુલ્લા છે.'), says('ઠીક છે.'), says('दो items खुले हैं।'));
    const first = (await t.as(alice).post('/assistant/messages', { text: 'કયા items હજુ ખુલ્લા છે?' })).json<AssistantReply>();
    await t.as(alice).post('/assistant/messages', { text: 'ok', conversationId: first.conversationId });
    await t.as(alice).post('/assistant/messages', { text: 'kaun se items khule hain, mujhe dikhao', replyLanguage: 'hi' });
    const [gu, bare, hi] = t.model.requests.map((request) => request.context ?? '');
    expect(gu).toContain('Their latest message is in Gujarati, in Gujarati script: answer in Gujarati, in Gujarati script.');
    expect(bare).toContain('This conversation is in Gujarati, in Gujarati script: answer in Gujarati, in Gujarati script.');
    // The choice in the settings, not the words, decides.
    expect(hi).toContain("Reply language, chosen in the app's settings: Hindi, in Devanagari, whatever language they write in.");
    expect(hi).not.toContain('Their latest message');
  });

  it("says the server's own sentences in the conversation's language: a cancelled card, a reply cut off", async () => {
    const alice = await t.signIn('alice');
    const propose = async (text: string, replyLanguage?: ReplyLanguage) => {
      t.model.queue(callsTool('fake__close_item', { id: '12', note: 'done' }));
      return (await t.as(alice).post('/assistant/messages', { text, ...(replyLanguage ? { replyLanguage } : {}) })).json<AssistantReply>();
    };
    const cancel = async (proposed: AssistantReply, replyLanguage?: ReplyLanguage) =>
      (
        await t.as(alice).post(`/assistant/conversations/${proposed.conversationId}/decision`, {
          confirmationId: proposed.confirmation!.id,
          decision: 'cancel',
          ...(replyLanguage ? { replyLanguage } : {}),
        })
      ).json<AssistantReply>().reply;

    expect(await cancel(await propose('item 12 બંધ કરો'))).toBe('ઠીક છે, મેં કંઈ બદલ્યું નથી.');
    expect(await cancel(await propose('item 12 बंद कर दो'))).toBe('ठीक है, मैंने कुछ नहीं बदला।');
    expect(await cancel(await propose('aaje item 12 bandh karo, maru kaam che'))).toBe('Thik che, me kai badlyu nathi.');
    expect(await cancel(await propose('Close item 12'))).toBe("Okay, I didn't change anything.");
    // The choice in the settings decides, whatever the card was asked in.
    expect(await cancel(await propose('Close item 12'), 'gu')).toBe('ઠીક છે, મેં કંઈ બદલ્યું નથી.');
    expect(await cancel(await propose('item 12 બંધ કરો'), 'en')).toBe("Okay, I didn't change anything.");

    t.model.queue(cutOff('અડધો જવાબ'));
    const cut = (await t.as(alice).post('/assistant/messages', { text: 'item 12 વિશે શું છે?' })).json<AssistantReply>();
    expect(cut.reply).toBe('માફ કરજો, એ સમજાયું નહીં. થોડું સરળ રીતે કહેશો?');
  });
});

describe('hearing Gujarati and Hindi', () => {
  it('shows Whisper the plant, its record words and its three languages, and lets it tell the language', async () => {
    const connector = createDcrsConnector({ baseUrl: 'http://dcrs.test:4000' });
    const prompt = transcriptionPrompt([connector]);
    expect(prompt).toBe(
      "Mitra; Digital Controlled Record System, DCRS, Gujarat Print Pack, Mehsana, F/QC/30, F/HR/17, CAPA. English, Gujarati, Hindi: Open today's record. આજનો રેકોર્ડ ખોલો. आज का रिकॉर्ड खोलो.",
    );
    // Groq's limit is 224 tokens: this prompt is 123 in Whisper's tokenizer, where a Gujarati letter can take three.
    expect(prompt.length).toBeLessThan(200);

    const sent: Record<string, unknown>[] = [];
    const groq = {
      audio: {
        transcriptions: {
          create: async (params: Record<string, unknown>) => {
            sent.push(params);
            return { text: '  આજનો F/QC/30 રેકોર્ડ ખોલો  ' };
          },
        },
      },
    } as unknown as Groq;
    const transcribe = groqTranscriber(testConfig({ transcriptionModel: 'whisper-large-v3' }), () => groq, [connector]);
    expect(await transcribe({ data: Buffer.alloc(2048, 1), filename: 'audio.m4a', mimeType: 'audio/mp4' })).toBe('આજનો F/QC/30 રેકોર્ડ ખોલો');
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ model: 'whisper-large-v3', prompt, response_format: 'json', temperature: 0 });
    // No language is forced: Whisper hears which one was spoken.
    expect(sent[0]).not.toHaveProperty('language');
  });

  it('hands back what was said in Gujarati or Hindi exactly as Whisper wrote it', async () => {
    const t = await setup();
    try {
      const alice = await t.signIn('alice');
      for (const said of ['આજે શું બાકી છે?', 'आज क्या बाकी है?', 'aaje nu record kholo']) {
        t.voice.state.text = ` ${said} `;
        const response = await t.app.inject({
          method: 'POST',
          url: '/assistant/transcribe',
          headers: { 'content-type': 'audio/mp4', authorization: `Bearer ${alice}` },
          payload: Buffer.alloc(4096, 7),
        });
        expect(response.statusCode).toBe(200);
        expect(response.json<TranscriptionResponse>()).toEqual({ text: said });
      }
    } finally {
      await t.close();
    }
  });
});
