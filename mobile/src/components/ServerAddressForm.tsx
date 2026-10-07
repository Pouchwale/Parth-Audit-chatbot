import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button, Field, Notice } from '@/components/ui';
import { Spacing, useTheme } from '@/constants/theme';
import { checkServer, errorMessage } from '@/lib/api';
import { addressProblem, normalizeAddress, shortAddress } from '@/lib/server-address';

/**
 * The installed app's box for the Mitra server's address (the sign-in screen and Settings). It takes the address the
 * way people type it ("192.168.62.195", port 3000 assumed, or a full http:// address), checks that the Mitra server
 * answers there, and only then hands it on, as the address to call, to `onReady`.
 */
export function ServerAddressForm({
  current,
  action,
  onReady,
  onCancel,
}: {
  /** The address in use now, to start from when changing it. */
  current?: string | null;
  /** The button's words. */
  action: string;
  /** Called with a checked address; an error it throws is shown under the box. */
  onReady(address: string): Promise<void> | void;
  /** Shown as a Cancel button when given. */
  onCancel?: () => void;
}) {
  const theme = useTheme();
  const [typed, setTyped] = useState(current ? shortAddress(current) : '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!typed.trim() || busy) return;
    const address = normalizeAddress(typed);
    if (!address) {
      setError(addressProblem('invalid'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await checkServer(address);
      await onReady(address);
    } catch (e) {
      setError(errorMessage(e));
    }
    setBusy(false);
  }

  return (
    <View style={styles.form}>
      <Field
        label="Mitra server address"
        value={typed}
        onChangeText={(text) => {
          setTyped(text);
          if (error) setError(null);
        }}
        placeholder="192.168.1.20"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
        keyboardType="url"
        returnKeyType="go"
        onSubmitEditing={submit}
      />
      <Text style={[styles.hint, { color: theme.textSecondary }]}>
        Your administrator can tell you this: the address of the computer that runs the Mitra server.
      </Text>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Button title={action} onPress={submit} busy={busy} disabled={!typed.trim()} />
      {onCancel ? <Button title="Cancel" kind="secondary" onPress={onCancel} disabled={busy} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: Spacing.md },
  hint: { fontSize: 13, lineHeight: 18, marginTop: -Spacing.xs },
});
