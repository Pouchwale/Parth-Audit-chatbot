import { useEffect, useState } from 'react';
import { Image, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ServerAddressForm } from '@/components/ServerAddressForm';
import { Button, Field, Notice } from '@/components/ui';
import { AppMark, AppName } from '@/constants/brand';
import { Radius, Spacing, useTheme } from '@/constants/theme';
import { api, ASKS_FOR_SERVER, errorMessage, saveServer, useServer } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { shortAddress } from '@/lib/server-address';

export default function SignInScreen() {
  const theme = useTheme();
  const { signIn, notice } = useAuth();
  const server = useServer();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The connected system's name, as the server at that address gave it.
  const [system, setSystem] = useState<{ server: string; name: string } | null>(null);
  // The installed app: the server's address is being entered again (Change server).
  const [changingServer, setChangingServer] = useState(false);
  const askingForServer = ASKS_FOR_SERVER && (!server || changingServer);

  const systemName = system && system.server === server ? system.name : null;

  useEffect(() => {
    if (!server) return;
    api
      .signInInfo()
      .then((info) => setSystem({ server, name: info.system }))
      .catch(() => undefined);
  }, [server]);

  async function submit() {
    if (!username.trim() || !password || busy) return;
    setBusy(true);
    setError(null);
    try {
      await signIn(username.trim(), password);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  async function chooseServer(address: string) {
    await saveServer(address);
    setChangingServer(false);
    setError(null);
  }

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]}>
      <KeyboardAvoidingView behavior="padding" style={styles.screen}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.content}>
            <Image source={AppMark} accessibilityIgnoresInvertColors style={styles.logo} />
            <Text style={[styles.title, { color: theme.text }]}>{AppName}</Text>

            {askingForServer ? (
              <>
                <Text style={[styles.lead, { color: theme.textSecondary }]}>
                  {server ? "Enter the Mitra server's new address." : "First, enter the Mitra server's address."}
                </Text>
                <ServerAddressForm
                  current={server}
                  action="Continue"
                  onReady={chooseServer}
                  onCancel={server ? () => setChangingServer(false) : undefined}
                />
              </>
            ) : (
              <>
                <Text style={[styles.lead, { color: theme.textSecondary }]}>
                  {systemName ? `Sign in with your ${systemName} account.` : 'Sign in with your work account.'}
                </Text>

                {notice ? <Notice>{notice}</Notice> : null}
                <Field
                  label="Username"
                  value={username}
                  onChangeText={setUsername}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="username"
                  textContentType="username"
                  returnKeyType="next"
                />
                <Field
                  label="Password"
                  value={password}
                  onChangeText={setPassword}
                  secret
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="current-password"
                  textContentType="password"
                  returnKeyType="go"
                  onSubmitEditing={submit}
                />
                {error ? <Notice tone="danger">{error}</Notice> : null}
                <Button title="Sign in" onPress={submit} busy={busy} disabled={!username.trim() || !password} />
                {ASKS_FOR_SERVER && server ? (
                  <View style={styles.serverRow}>
                    <Text style={[styles.serverText, { color: theme.textSecondary }]} numberOfLines={2}>
                      Server: {shortAddress(server)}
                    </Text>
                    <Pressable
                      accessibilityRole="button"
                      disabled={busy}
                      onPress={() => {
                        setError(null);
                        setChangingServer(true);
                      }}
                      hitSlop={8}
                      style={styles.serverChange}>
                      <Text style={[styles.serverChangeText, { color: theme.accent }]}>Change server</Text>
                    </Pressable>
                  </View>
                ) : null}
              </>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: Spacing.xl },
  content: { width: '100%', maxWidth: 420, alignSelf: 'center', gap: Spacing.lg },
  logo: { width: 64, height: 64, borderRadius: Radius.lg },
  title: { fontSize: 28, fontWeight: '700' },
  lead: { fontSize: 16, lineHeight: 22, marginTop: -Spacing.sm },
  serverRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.md, flexWrap: 'wrap' },
  serverText: { flexShrink: 1, fontSize: 14 },
  serverChange: { minHeight: 44, justifyContent: 'center' },
  serverChangeText: { fontSize: 14, fontWeight: '600' },
});
