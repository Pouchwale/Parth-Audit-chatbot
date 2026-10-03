// How the app splits a reply's markdown into blocks it can draw one at a time (mobile/src/components/chat/markdown-blocks.ts).
// The app has no test runner of its own, and this is a plain function, so it is checked here with the server's tests.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

interface BlocksModule {
  splitBlocks(markdown: string): string[];
}
const APP_MODULE: string = new URL('../../mobile/src/components/chat/markdown-blocks.ts', import.meta.url).href;
const { splitBlocks } = (await import(APP_MODULE)) as BlocksModule;

// The markdown parser the app draws with (react-native-marked parses with marked, gfm on), from the app's own packages.
interface MarkedModule {
  Marked: new (options: { gfm: boolean; async: false }) => { parse(markdown: string): string };
}
const MARKED = new URL('../../mobile/node_modules/marked/lib/marked.esm.js', import.meta.url);
const haveMarked = existsSync(fileURLToPath(MARKED));
const marked = haveMarked ? new ((await import(MARKED.href)) as MarkedModule).Marked({ gfm: true, async: false }) : undefined;
/** The HTML marked makes of some markdown, without the spaces between its tags. */
const html = (markdown: string): string => marked!.parse(markdown).replace(/>\s+</g, '><').trim();

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
  // Backticks after a backtick fence make it inline code, not a fence: the blank line after it ends the block.
  expect(splitBlocks('``` js `x`\n\nNext.')).toEqual(['``` js `x`', 'Next.']);
});

it('keeps a list together across blank lines between its items, so it does not become two lists', () => {
  const loose = '- one\n\n- two\n\n- three';
  expect(splitBlocks(`Intro:\n\n${loose}\n\nAfter.`)).toEqual(['Intro:', loose, 'After.']);
  expect(splitBlocks('1. first\n\n2. second\n\nNot a list.')).toEqual(['1. first\n\n2. second', 'Not a list.']);
  // An item that goes on over two lines carries the list on too.
  expect(splitBlocks('- a\n  more\n\n- b')).toEqual(['- a\n  more\n\n- b']);
});

it('keeps what is indented under a list item with the item, blank lines and all', () => {
  // A model's numbered steps: an explanation and a nested list under a step, each after a blank line. Apart, they
  // would read as two "code" boxes between two lists, the second starting at 2.
  const steps =
    '1. **Open the record**\n\n    Go to Records and pick F-QC-30 for today.\n\n2. **Check these lines first:**\n\n    - Line 1: viscosity\n    - Line 2: tested by\n\n3. **Submit it** when every line is filled.';
  expect(splitBlocks(`To fill today's F-QC-30:\n\n${steps}\n\nThat's all.`)).toEqual(["To fill today's F-QC-30:", steps, "That's all."]);
  // More of an indented code block after a blank line stays in it.
  expect(splitBlocks('Run:\n\n    one\n\n    two\n\nDone.')).toEqual(['Run:\n\n    one\n\n    two', 'Done.']);
  // Once a code fence appears inside a list, the rest of the text is one block: where such a fence ends depends on
  // how far in each line is.
  const code = '- Run this:\n\n  ```\n  start F-QC-30\n  ```\n\n- Then confirm.\n\nDone.';
  expect(splitBlocks(`First.\n\n${code}`)).toEqual(['First.', code]);
});

it('keeps the text whole when a link is defined in it or a line starts with HTML', () => {
  const reference = "See [the format's guide][guide] for the ranges.\n\n[guide]: https://example.com/formats/F-QC-30";
  expect(splitBlocks(reference)).toEqual([reference]);
  const inList = 'Read [this][a].\n\n- [a]: https://example.com/a';
  expect(splitBlocks(inList)).toEqual([inList]);
  const comment = 'Before.\n\n<!-- a note\n\nstill the note -->\n\nAfter.';
  expect(splitBlocks(comment)).toEqual([comment]);
});

it('keeps tables and other blocks whole and in order', () => {
  const table = '| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |';
  const blocks = splitBlocks(`Text.\n\n${table}\n\n- item\n- item two\n\n> quoted\n> more`);
  expect(blocks).toEqual(['Text.', table, '- item\n- item two', '> quoted\n> more']);
  // Joined back, nothing of the text is lost.
  expect(blocks.join('\n\n')).toBe(`Text.\n\n${table}\n\n- item\n- item two\n\n> quoted\n> more`);
});

it.skipIf(!haveMarked)('reads exactly as the whole text does, finished or streaming in, as the app parses it (needs the app installed)', () => {
  // Replies made of the markdown a model writes, at random but the same every run: paragraphs, headings, lists with
  // paragraphs, lists and code under their items at every indent, tables, code fences of every kind (closed, not, or
  // closed wrongly), indented code, quotes, HTML, link references, rules and underlined headings.
  let seed = 2026;
  const random = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;
  const words = () => pick(['Fill the **viscosity** line.', 'Check `F-QC-30` first.', 'See [the guide](https://example.com/g).', 'All within range', 'Done.']);
  const indent = () => pick(['', ' ', '  ', '   ', '    ', '     ', '\t']);
  const fence = () => pick(['```', '````', '~~~', '```json', '``` js `x`']);
  const separator = () => pick(['\n', '\n\n', '\n\n', '\n\n\n', '\n \n']);
  const chunk = (depth: number): string => {
    switch (Math.floor(random() * 15)) {
      case 0:
        return words();
      case 1:
        return `${words()}\n${indent()}${words()}`;
      case 2:
        return `${pick(['#', '##', '###'])} ${words()}`;
      case 3: {
        const ordered = random() < 0.5;
        const items = Array.from({ length: 1 + Math.floor(random() * 3) }, (_, i) => `${ordered ? `${i + 1}.` : pick(['-', '*', '+'])} ${words()}`);
        const under = (item: string) => `${item}${separator()}${indent()}${chunk(depth + 1).split('\n').join(`\n${indent()}`)}`;
        return items.map((item) => (random() < 0.5 && depth < 2 ? under(item) : item)).join(pick(['\n', '\n\n']));
      }
      case 4:
        return '| Hour | Value |\n|---|---|\n| 08:00 | 19.4 |';
      case 5: {
        const close = random() < 0.8 ? `\n${indent()}${pick(['```', '~~~', '````', '```~~'])}` : '';
        return `${indent().slice(0, 3)}${fence()}\n{\n  "a": 1,\n\n  "b": 2\n}${close}`;
      }
      case 6:
        return '    code line\n\n    more code';
      case 7:
        return pick(['> quoted\n> more', '> a\n\n> b', '> a\n>\n> b']);
      case 8:
        return pick(['<!-- note\n\nstill note -->', '<div>\nx\n</div>', 'a <b>bold</b> word']);
      case 9:
        return pick(['See [the record][r].', '[r]: https://example.com/r']);
      case 10:
        return pick(['---', '***', '* * *']);
      case 11:
        return `${words()}\n${pick(['===', '---'])}`;
      case 12:
        return `${pick(['-', '1.'])} ${words()}\n${indent()}${fence()}\n${indent()}code\n\n${indent()}more\n${indent()}${pick(['```', '~~~', ''])}`;
      case 13:
        return `${pick(['-', '1.', '10.'])} ${words()}\n\n${indent()}${words()}`;
      default:
        return `${pick(['- ', '1. '])}${fence()}\n${indent()}x\n${pick(['```', '  ```', '    ```'])}`;
    }
  };

  let compared = 0;
  let split = 0;
  for (let reply = 0; reply < 400; reply++) {
    const text = Array.from({ length: 1 + Math.floor(random() * 6) }, () => chunk(0)).reduce((all, part) => `${all}${separator()}${part}`);
    // The reply as it streams in: up to every line's end, and a few places inside lines.
    const ends = new Set([text.length]);
    for (let i = 0; i < text.length; i++) if (text[i] === '\n' || random() < 0.02) ends.add(i);
    for (const end of ends) {
      // marked keeps a last line of only spaces in the paragraph before it. The app drops it either way.
      const shown = text.slice(0, end).replace(/(?:\n[ \t]*)+$/, '');
      const blocks = splitBlocks(shown);
      if (blocks.length > 1) split++;
      compared++;
      expect(blocks.map(html).join(''), JSON.stringify(shown)).toBe(html(shown));
    }
  }
  // Most texts are split, so this checks the splitting, not only the texts kept whole.
  expect(split).toBeGreaterThan(compared / 4);
});
