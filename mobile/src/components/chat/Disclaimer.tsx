import { useEffect, useState } from 'react';
import { Keyboard, Platform, StyleSheet, Text } from 'react-native';
import { Spacing, useTheme } from '@/constants/theme';

/**
 * A reminder under the message box that replies can be wrong. It steps aside while the phone's keyboard is up, so that
 * on a small screen it never pushes the box out of view.
 */
export function Disclaimer() {
  const theme = useTheme();
  const keyboardShown = useKeyboardShown();
  if (keyboardShown) return null;
  return (
    <Text style={[styles.text, { color: theme.textSecondary }]}>
      Audit Assistant can make mistakes. Double-check important details before you act on them.
    </Text>
  );
}

function useKeyboardShown(): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    // iPhones say so as the keyboard starts to move, Android once it has.
    const ios = Platform.OS === 'ios';
    const subscriptions = [
      Keyboard.addListener(ios ? 'keyboardWillShow' : 'keyboardDidShow', () => setShown(true)),
      Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', () => setShown(false)),
    ];
    return () => subscriptions.forEach((subscription) => subscription.remove());
  }, []);
  return shown;
}

const styles = StyleSheet.create({
  text: { fontSize: 12, lineHeight: 16, textAlign: 'center', paddingHorizontal: Spacing.lg, paddingBottom: Spacing.sm, marginTop: -Spacing.xs },
});
