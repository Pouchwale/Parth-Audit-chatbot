import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

/** A light tap felt on phones. Browsers could only buzz, so the web app stays still. */
export function tapFeedback(): void {
  if (Platform.OS === 'web') return;
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
}
