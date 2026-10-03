// Splits markdown into blocks that can be parsed on their own, so that a reply streaming in is parsed only where it
// is still being written. Plain functions with no imports, so the server's tests can check them.

/** A line that opens a fenced code block: up to 3 spaces, then 3 or more backticks or tildes, then its info. */
const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
/** Any line that starts with a fence, however far in: inside a list item, it may belong to the item or not. */
const FENCE_ANYWHERE = /^[ \t]*(?:`{3,}|~{3,})/;
/** A list item's first line: a bullet, or a number with a dot or a bracket, then a space, a tab or the line's end. */
const LIST_ITEM = /^ {0,3}(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/;
const BLANK = /^[ \t]*$/;
/** After a blank line, a line that starts further in may still belong to what came before it. */
const INDENTED = /^[ \t]/;
/**
 * What can reach across blocks: a link defined anywhere, even inside a list or a quote, is used anywhere; and a line
 * of HTML starts a block that some kinds run on past blank lines, and that takes in lines which look like code fences.
 * Text with either is drawn as one block. Matching more than these only costs speed.
 */
const WHOLE = /\[[^\]\n]+\]:|^[ \t>]*<[A-Za-z!?/]/m;

/**
 * The text's blocks, in order, each of which parses on its own exactly as it does within the whole text. A block ends
 * only where markdown starts afresh: at a blank line followed by a line at the left margin that does not carry on a
 * list. So a list keeps the items, paragraphs, nested lists and code under it, blank lines and all, and a fenced code
 * block runs to its closing fence. Text that could read differently in pieces is kept whole: one with a link
 * definition or a line of HTML (see WHOLE), and the rest of a list once a code fence appears inside it, as where
 * such a fence ends depends on how far in each line is. Joined back with "\n\n" the blocks give the text again, bar
 * surplus blank lines between them. The empty text gives [""], so there is always one block to draw.
 */
export function splitBlocks(markdown: string): string[] {
  if (WHOLE.test(markdown)) return [markdown];
  const lines = markdown.split('\n');
  const blocks: string[] = [];
  let current: string[] = [];
  let blanks: string[] = [];
  /** The fence that opened the code block the text is in: its line's backticks or tildes. */
  let fence: string | null = null;
  let inList = false;

  const close = () => {
    if (current.length > 0) blocks.push(current.join('\n'));
    current = [];
    inList = false;
  };

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    if (fence) {
      current.push(line);
      if (closes(line, fence)) fence = null;
      continue;
    }
    if (BLANK.test(line)) {
      if (current.length > 0) blanks.push(line);
      continue;
    }
    if (blanks.length > 0) {
      // An indented line can still belong to a list item or an indented code block, and a list item carries the list
      // on: their blank lines stay in the block. Anything else at the left margin starts a new one.
      if (INDENTED.test(line) || (inList && LIST_ITEM.test(line))) current.push(...blanks);
      else close();
      blanks = [];
    }
    if (inList && FENCE_ANYWHERE.test(line)) {
      current.push(...lines.slice(index));
      break;
    }
    fence = opens(line);
    if (LIST_ITEM.test(line)) inList = true;
    current.push(line);
  }
  close();
  return blocks.length > 0 ? blocks : [''];
}

/** The fence a line opens, or null. As in marked, a backtick fence can't have a backtick after it: that is inline code. */
function opens(line: string): string | null {
  const match = FENCE.exec(line);
  if (!match) return null;
  const [, fence = '', info = ''] = match;
  return fence.startsWith('`') && info.includes('`') ? null : fence;
}

/** Whether a line closes the code block `fence` opened, by marked's rule: the same fence, then only more of either kind. */
function closes(line: string, fence: string): boolean {
  const rest = /^ {0,3}(.*)$/.exec(line)?.[1] ?? '';
  return rest.startsWith(fence) && /^[~`]* *$/.test(rest.slice(fence.length));
}
