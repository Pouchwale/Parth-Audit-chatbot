/**
 * Markdown as plain sentences for reading aloud: marks removed, links and images reduced to their text,
 * code blocks skipped, and every line ending in punctuation so the voice pauses between them.
 */
export function stripMarkdown(markdown: string): string {
  const text = markdown
    .replace(/\r\n?/g, '\n')
    .replace(/```[\s\S]*?(?:```|$)/g, '\nCode block omitted.\n')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<\/?[a-z][^>\n]*>/gi, '')
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '')
    .replace(/^[ \t]{0,3}>[ \t]?/gm, '')
    .replace(/^[ \t]*([-*_])(?:[ \t]*\1){2,}[ \t]*$/gm, '')
    .replace(/^[ \t]*\|?(?:[ \t]*:?-{3,}:?[ \t]*\|?)+[ \t]*$/gm, '')
    .replace(/^[ \t]*\|(.*)\|[ \t]*$/gm, '$1')
    .replace(/[ \t]*\|[ \t]*/g, ', ')
    .replace(/^[ \t]*[-*+][ \t]+\[[ xX]\][ \t]+/gm, '')
    .replace(/^[ \t]*[-*+][ \t]+/gm, '')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|[^\w*])[*_]([^*_\n]+)[*_](?=[^\w*]|$)/g, '$1$2')
    .replace(/~~(.+?)~~/g, '$1');
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => (/[.!?:;]$/.test(line) ? line : `${line}.`))
    .join(' ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}
