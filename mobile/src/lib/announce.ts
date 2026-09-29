import { AccessibilityInfo, Platform } from 'react-native';

/**
 * Reads a message out loud on phones, where screen readers don't announce a notice appearing. Queued, so that it
 * follows what they say as a share sheet or another app closes. Browsers announce the notice itself, by its alert role.
 */
export function announce(message: string): void {
  if (Platform.OS !== 'web') AccessibilityInfo.announceForAccessibilityWithOptions(message, { queue: true });
}
