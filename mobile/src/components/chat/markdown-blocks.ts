// Splits markdown into blocks that can be parsed on their own, so that a reply streaming in is parsed only where it
// is still being written. Plain functions with no imports, so the server's tests can check them.

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const LIST_ITEM = /^ {0,3}(?:[-*+]|\d{1,9}[.)])\s/;
const BLANK = /^\s*$/;

/**
 * The text's blocks, in order: runs of lines separated by blank lines, except that a blank line inside a fenced code
 * block does not end it, and a list goes on past blank lines between its items (markdown makes that one "loose"
 * list, which would read differently as two). Joined back with "\n\n" they give the text again, bar surplus blank lines.
 * The empty text gives [""], so there is always one block to draw.
 */
export function splitBlocks(markdown: string): string[] {
  const lines = markdown.split('\n');
  const blocks: string[] = [];
  let current: string[] = [];
  let fence: string | null = null;
  let pendingBlank = false;

  const close = () => {
    if (current.length > 0) blocks.push(current.join('\n'));
    current = [];
    pendingBlank = false;
  };

  for (const line of lines) {
    if (fence) {
      current.push(line);
      const match = FENCE.exec(line);
      // The closing fence: the same character, at least as long, and nothing else on the line.
      if (match && match[1][0] === fence[0] && match[1].length >= fence.length && line.trim() === match[1]) fence = null;
      continue;
    }
    if (BLANK.test(line)) {
      if (current.length > 0) pendingBlank = true;
      continue;
    }
    if (pendingBlank) {
      // A list item after a blank line continues the list; anything else starts a new block.
      if (LIST_ITEM.test(line) && LIST_ITEM.test(current[current.length - 1] ?? '')) current.push('');
      else close();
    }
    const match = FENCE.exec(line);
    if (match) fence = match[1];
    current.push(line);
  }
  close();
  return blocks.length > 0 ? blocks : [''];
}
