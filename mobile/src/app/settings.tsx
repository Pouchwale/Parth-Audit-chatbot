import Ionicons from '@expo/vector-icons/Ionicons';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar, Button, Card, Chip, Notice, SectionTitle, SegmentedControl, Toggle } from '@/components/ui';
import { MaxContentWidth, Spacing, useTheme } from '@/constants/theme';
import { api, errorMessage, SERVER_URL } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useConfirm } from '@/lib/confirm';
import { useConversations } from '@/lib/conversations';
import { ROLE_LABEL } from '@/lib/format';
import { useSettings, type AppearancePreference, type ReadAloudPreference, type ReplyLanguage } from '@/lib/settings';
import { DOWNLOADS_RECORDED } from '@/lib/share';

const APPEARANCE_OPTIONS: readonly { value: AppearancePreference; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

// Each language named in its own script, as people look for it; a screen reader says its English name.
const REPLY_LANGUAGE_OPTIONS: readonly { value: ReplyLanguage; label: string; spoken?: string }[] = [
  { value: 'auto', label: 'The language I write in' },
  { value: 'en', label: 'English' },
  { value: 'gu', label: 'ગુજરાતી', spoken: 'Gujarati' },
  { value: 'hi', label: 'हिन्दी', spoken: 'Hindi' },
];

const READ_ALOUD_OPTIONS: readonly { value: ReadAloudPreference; label: string }[] = [
  { value: 'never', label: 'Never' },
  { value: 'afterVoice', label: 'After voice messages' },
  { value: 'always', label: 'Always' },
];

export default function SettingsScreen() {
  const theme = useTheme();
  const { settings, update } = useSettings();
  // The bars at the bottom (Android's gesture or button bar, the iPhone's home indicator) sit over the content.
  const insets = useSafeAreaInsets();

  return (
    <ScrollView contentContainerStyle={[styles.content, { paddingBottom: Spacing.xxl + insets.bottom }]}>
      <ProfileCard />

      <SectionTitle>Appearance</SectionTitle>
      <SegmentedControl
        label="Appearance"
        options={APPEARANCE_OPTIONS}
        value={settings.appearance}
        onChange={(appearance) => update({ appearance })}
      />

      <SectionTitle>Language</SectionTitle>
      <Card>
        <Text style={[styles.label, { color: theme.text }]}>Mitra replies in</Text>
        <View accessibilityRole="radiogroup" accessibilityLabel="Mitra replies in">
          {REPLY_LANGUAGE_OPTIONS.map((option) => (
            <RadioRow
              key={option.value}
              label={option.label}
              spoken={option.spoken}
              selected={settings.replyLanguage === option.value}
              onPress={() => update({ replyLanguage: option.value })}
            />
          ))}
        </View>
        <Text style={[styles.hint, { color: theme.textSecondary }]}>
          You can ask in English, Gujarati or Hindi, in its own letters or in English letters.
        </Text>
      </Card>

      <SectionTitle>Voice</SectionTitle>
      <Card>
        <Text style={[styles.label, { color: theme.text }]}>Read replies aloud</Text>
        <View accessibilityRole="radiogroup" accessibilityLabel="Read replies aloud">
          {READ_ALOUD_OPTIONS.map((option) => (
            <RadioRow
              key={option.value}
              label={option.label}
              selected={settings.readAloud === option.value}
              onPress={() => update({ readAloud: option.value })}
            />
          ))}
        </View>
        <View style={[styles.divider, { backgroundColor: theme.border }]} />
        <View style={styles.switchRow}>
          <View style={styles.column}>
            <Text style={[styles.label, { color: theme.text }]}>Send voice messages automatically</Text>
            <Text style={[styles.hint, { color: theme.textSecondary }]}>
              When this is off, what you said goes into the message box so you can edit it first.
            </Text>
          </View>
          <Toggle
            label="Send voice messages automatically"
            value={settings.autoSendVoice}
            onValueChange={(autoSendVoice) => update({ autoSendVoice })}
          />
        </View>
      </Card>

      <SectionTitle>History</SectionTitle>
      <Text style={[styles.hint, styles.historyHint, { color: theme.textSecondary }]}>
        Share a chat from the top of the chat or its menu in the chat list to download it. {DOWNLOADS_RECORDED}
      </Text>
      <DeleteHistory />

      <SectionTitle>About</SectionTitle>
      <Card>
        <InfoRow label="App version" value={Constants.expoConfig?.version ?? 'Unknown'} />
        <InfoRow label="Server" value={SERVER_URL ?? 'Not known'} />
      </Card>

      <SignOut />
    </ScrollView>
  );
}

function ProfileCard() {
  const theme = useTheme();
  const { user } = useAuth();
  const [system, setSystem] = useState<string | null>(null);

  useEffect(() => {
    api
      .signInInfo()
      .then((info) => setSystem(info.system))
      .catch(() => undefined);
  }, []);

  if (!user) return null;
  return (
    <Card style={styles.profile}>
      <Avatar name={user.displayName} size={52} />
      <View style={styles.column}>
        <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>
          {user.displayName}
        </Text>
        <Text style={[styles.hint, { color: theme.textSecondary }]} numberOfLines={1}>
          {user.username}
        </Text>
        <Chip label={ROLE_LABEL[user.role]} tone={user.role === 'super_admin' ? 'accent' : 'neutral'} />
        {/* Keeps its line while the name loads, so the card doesn't grow afterwards. */}
        <Text style={[styles.hint, { color: theme.textSecondary }]} numberOfLines={2}>
          {system ? `Signed in to ${system}` : ' '}
        </Text>
      </View>
    </Card>
  );
}

/** One choice of a radio group. `spoken` is what a screen reader says for it, when that differs from the label. */
function RadioRow({ label, spoken, selected, onPress }: { label: string; spoken?: string | undefined; selected: boolean; onPress(): void }) {
  const theme = useTheme();
  return (
    <Pressable accessibilityRole="radio" accessibilityLabel={spoken} aria-checked={selected} onPress={onPress} style={styles.radioRow}>
      <Ionicons
        name={selected ? 'radio-button-on' : 'radio-button-off'}
        size={22}
        color={selected ? theme.accent : theme.textSecondary}
      />
      <Text style={[styles.radioLabel, { color: theme.text }]}>{label}</Text>
    </Pressable>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <View style={styles.infoRow}>
      <Text style={[styles.label, { color: theme.text }]}>{label}</Text>
      <Text selectable style={[styles.infoValue, { color: theme.textSecondary }]}>
        {value}
      </Text>
    </View>
  );
}

function DeleteHistory() {
  const { removeAll } = useConversations();
  const ask = useConfirm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function deleteAll() {
    const confirmed = await ask(
      'Delete all conversations?',
      'Every conversation will be removed from your history. Changes the assistant made stay in the audit log.',
      'Delete all',
    );
    if (!confirmed) return;
    setBusy(true);
    setError(null);
    try {
      await removeAll();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
      return;
    }
    router.dismissTo('/');
  }

  return (
    <View style={styles.column}>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Button title="Delete all conversations" kind="danger" onPress={deleteAll} busy={busy} />
    </View>
  );
}

function SignOut() {
  const { signOut } = useAuth();
  const ask = useConfirm();
  const [busy, setBusy] = useState(false);

  async function confirmSignOut() {
    const confirmed = await ask('Sign out?', "You'll need to sign in again to use the assistant on this device.", 'Sign out');
    if (!confirmed) return;
    setBusy(true);
    await signOut();
  }

  return <Button title="Sign out" kind="secondary" onPress={confirmSignOut} busy={busy} style={styles.signOut} />;
}

const styles = StyleSheet.create({
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxl, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  profile: { flexDirection: 'row', alignItems: 'center', gap: Spacing.lg },
  name: { fontSize: 18, fontWeight: '700' },
  column: { flex: 1, gap: Spacing.xs },
  label: { fontSize: 16, fontWeight: '500' },
  hint: { fontSize: 13, lineHeight: 18 },
  historyHint: { marginBottom: Spacing.sm },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: Spacing.xs },
  radioRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, minHeight: 44 },
  radioLabel: { fontSize: 15 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: Spacing.md, paddingVertical: Spacing.xs },
  infoValue: { flexShrink: 1, fontSize: 14, textAlign: 'right' },
  signOut: { marginTop: Spacing.xl },
});
