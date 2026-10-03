// The request the model is sent: the same start for everyone, every day, so Groq can reuse its work on it, and small
// enough for the free plan's 8,000 tokens a minute.
import { expect, it } from 'vitest';
import { wireMessages } from '../src/agent/model.ts';
import { turnContext } from '../src/agent/prompt.ts';
import { windowOf } from '../src/agent/window.ts';
import { sizesOf, typicalRequest } from './request-size.ts';

const kapila = { displayName: 'Kapila Barad', username: 'kapila.barad@gpp.local', now: new Date('2026-10-02T06:00:00Z'), timeZone: 'Asia/Kolkata' };
const vinay = { displayName: 'Vinay Bhojak', username: 'vinay.bhojak@gpp.local', now: new Date('2026-10-03T12:30:00Z'), timeZone: 'Europe/London' };

it('starts every request with the same bytes for every person and every day: the instructions, then the tools', () => {
  const a = typicalRequest(kapila);
  const b = typicalRequest(vinay);
  expect(a.system).toBe(b.system);
  expect(JSON.stringify(a.tools)).toBe(JSON.stringify(b.tools));
  // As sent: the first message is the instructions, and only what follows differs.
  const [firstA, ...restA] = wireMessages(a);
  const [firstB, ...restB] = wireMessages(b);
  expect(firstA).toEqual(firstB);
  expect(JSON.stringify(a.system) + JSON.stringify(a.tools)).toBe(JSON.stringify(b.system) + JSON.stringify(b.tools));
  expect(restA[0]).not.toEqual(restB[0]);
  // Nothing of the person or the day leaks into the start.
  for (const word of ['Kapila', 'kapila.barad', 'Vinay', '2026', 'Asia/Kolkata', 'October']) {
    expect(a.system).not.toContain(word);
    expect(JSON.stringify(a.tools)).not.toContain(word);
  }
  expect(a.context).toContain('Kapila Barad');
  expect(a.context).toContain('Friday, 2 October 2026 (2026-10-02)');
  expect(b.context).toContain('Saturday, 3 October 2026 (2026-10-03)');
  expect(b.context).toContain('Europe/London');
});

it('keeps the standing part of the request within the free plan, and reports its size', () => {
  const sizes = sizesOf(typicalRequest(kapila));
  // Before 2-Oct-2026 the instructions and tools took 11,735 characters (about 2,800 tokens as JSON).
  expect(sizes.staticPrefix).toBeLessThan(11_000);
  expect(sizes.estimatedTokens).toBeLessThan(2_900);
  console.log(`request size: ${JSON.stringify(sizes)}`);
});

it('sends the turn being answered in full and as many whole earlier turns as fit, and says when the start was left out', () => {
  const long = Array.from({ length: 12 }, (_, i) => [
    { role: 'user' as const, content: `Question ${i}: ${'x'.repeat(400)}` },
    { role: 'assistant' as const, content: `Answer ${i}: ${'y'.repeat(400)}`, reasoning: 'Thinking.' },
  ]).flat();
  expect(windowOf(long, 100_000)).toEqual({ messages: long.map((m, i) => (i === long.length - 1 ? m : { role: m.role, content: m.content })), trimmed: false });
  const { messages, trimmed } = windowOf(long, 3_000);
  expect(trimmed).toBe(true);
  // The latest turn in full, then whole earlier turns, newest first, within the budget (about 830 characters each).
  expect(messages.slice(-2)).toEqual(long.slice(-2));
  expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant', 'user', 'assistant', 'user', 'assistant']);
  expect(messages[0]!.content).toContain('Question 8');
  // Only the turn being answered keeps the model's reasoning; an earlier turn's long results are cut short.
  expect('reasoning' in messages[1]!).toBe(false);
  const results = [
    { role: 'user' as const, content: 'Old' },
    { role: 'assistant' as const, content: '', tool_calls: [{ id: 'c1', type: 'function' as const, function: { name: 'dcrs__get_record', arguments: '{}' } }] },
    { role: 'tool' as const, tool_call_id: 'c1', content: 'r'.repeat(2_000) },
    { role: 'assistant' as const, content: 'Read it.' },
    { role: 'user' as const, content: 'New' },
  ];
  const cut = windowOf(results, 100_000).messages;
  expect(cut[1]).toEqual(results[1]);
  expect((cut[2] as { content: string }).content).toMatch(/^r{600}…\(cut short/);
  expect(cut.slice(3)).toEqual(results.slice(3));
  // The note says so only when something was left out.
  expect(turnContext({ ...kapila, trimmed: true })).toContain('The start of this conversation is no longer shown here.');
  expect(turnContext(kapila)).not.toContain('no longer shown');
});
