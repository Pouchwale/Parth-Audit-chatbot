const YES = /^(yes|yeah|yep|yup|ok|okay|sure|confirm|confirmed|go ahead|do it|proceed)( (yes|yeah|ok|okay|sure|confirm|go ahead|do it|proceed))*$/;
const NO = /^(no|nope|cancel|stop|don't|do not|never mind|nevermind)( (no|cancel|stop|don't|do not|never mind))*$/;

/**
 * Reads a spoken or typed answer to a waiting confirmation. Only a short, plain yes or no counts:
 * "okay, close item 13 instead" is a new request, which drops the waiting change.
 */
export function answerTo(text: string): 'confirm' | 'cancel' | null {
  const words = text
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/[^a-z' ]+/g, ' ')
    .split(' ')
    .filter((word) => word && !['please', 'thanks', 'thank', 'you'].includes(word))
    .join(' ');
  if (YES.test(words)) return 'confirm';
  if (NO.test(words)) return 'cancel';
  return null;
}
