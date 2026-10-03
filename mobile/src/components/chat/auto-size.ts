import { Platform, type TextStyle } from 'react-native';

/**
 * Whether this browser sizes a text box to its content by itself (CSS field-sizing: Chromium-based browsers, which is
 * what Android phones and the plant's PCs run). Then the box needs no measuring from JavaScript, which would make the
 * browser lay the whole page out again on every keystroke. Other browsers, and phones, are told the size instead.
 */
export const BROWSER_SIZES_TEXT_BOX: boolean =
  Platform.OS === 'web' && typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('field-sizing', 'content');

/** The style that lets the browser size the box; nothing elsewhere. */
export const AUTO_SIZE_STYLE: TextStyle | null = BROWSER_SIZES_TEXT_BOX ? ({ fieldSizing: 'content' } as unknown as TextStyle) : null;

/** Whether the box must report its content size, for the app to set its height (browsers without field-sizing). */
export const REPORTS_CONTENT_SIZE: boolean = Platform.OS === 'web' && !BROWSER_SIZES_TEXT_BOX;
