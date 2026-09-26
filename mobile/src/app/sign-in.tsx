import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Field, Notice } from '@/components/ui';
import { Radius, Spacing, useTheme } from '@/constants/theme';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export default function SignInScreen() {
  const theme = useTheme();
  const { signIn, notice } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [system, setSystem] = useState<string | null>(null);

  useEffect(() => {
    api
      .signInInfo()
      .then((info) => setSystem(info.system))
      .catch(() => undefined);
  }, []);

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

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]}>
      <KeyboardAvoidingView behavior="padding" style={styles.screen}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.content}>
            <View style={[styles.logo, { backgroundColor: theme.accentSoft }]}>
              <Ionicons name="mic" size={32} color={theme.accent} />
            </View>
            <Text style={[styles.title, { color: theme.text }]}>Audit Assistant</Text>
            <Text style={[styles.lead, { color: theme.textSecondary }]}>
              {system ? `Sign in with your ${system} account.` : 'Sign in with your work account.'}
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
  logo: { width: 64, height: 64, borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 28, fontWeight: '700' },
  lead: { fontSize: 16, lineHeight: 22, marginTop: -Spacing.sm },
});
