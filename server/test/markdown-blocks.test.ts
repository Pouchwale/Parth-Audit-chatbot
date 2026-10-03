// How the app splits a reply's markdown into blocks it can draw one at a time (mobile/src/components/chat/markdown-blocks.ts).
// The app has no test runner of its own, and this is a plain function, so it is checked here with the server's tests.
import { expect, it } from 'vitest';

interface BlocksModule {
  splitBlocks(markdown: string): string[];
}
const APP_MODULE: string = new URL('../../mobile/src/components/chat/markdown-blocks.ts', import.meta.url).href;
const { splitBlocks } = (await import(APP_MODULE)) as BlocksModule;

it('splits at blank lines, so that a reply streaming in parses only the block being written', () => {
  expect(splitBlocks('One paragraph.\n\nAnother, with **bold**.\n\n# A heading\nUnder it.')).toEqual([
    'One paragraph.',
    'Another, with **bold**.',
    '# A heading\nUnder it.',
  ]);
  expect(splitBlocks('Several\n\n\n\nblank lines')).toEqual(['Several', 'blank lines']);
  expect(splitBlocks('')).toEqual(['']);
  expect(splitBlocks('\n\n')).toEqual(['']);
});

it('keeps a fenced code block whole, blank lines and all, until its closing fence', () => {
  const code = '```json\n{\n  "a": 1,\n\n  "b": 2\n}\n```';
  expect(splitBlocks(`Before.\n\n${code}\n\nAfter.`)).toEqual(['Before.', code, 'After.']);
  // Still open while it streams in: everything after the fence is one block.
  expect(splitBlocks('Before.\n\n```\nline\n\nmore')).toEqual(['Before.', '```\nline\n\nmore']);
  // A fence of tildes closes only with tildes; a longer fence of the same kind closes it too.
  expect(splitBlocks('~~~\ncode\n```\n\nstill code\n~~~~\n\nAfter.')).toEqual(['~~~\ncode\n```\n\nstill code\n~~~~', 'After.']);
});

it('keeps a list together across blank lines between its items, so it does not become two lists', () => {
  const loose = '- one\n\n- two\n\n- three';
  expect(splitBlocks(`Intro:\n\n${loose}\n\nAfter.`)).toEqual(['Intro:', loose, 'After.']);
  expect(splitBlocks('1. first\n\n2. second\n\nNot a list.')).toEqual(['1. first\n\n2. second', 'Not a list.']);
});

it('keeps tables and other blocks whole and in order', () => {
  const table = '| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |';
  const blocks = splitBlocks(`Text.\n\n${table}\n\n- item\n- item two\n\n> quoted\n> more`);
  expect(blocks).toEqual(['Text.', table, '- item\n- item two', '> quoted\n> more']);
  // Joined back, nothing of the text is lost.
  expect(blocks.join('\n\n')).toBe(`Text.\n\n${table}\n\n- item\n- item two\n\n> quoted\n> more`);
});
