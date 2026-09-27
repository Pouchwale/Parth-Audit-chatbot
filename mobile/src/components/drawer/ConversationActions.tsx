import Ionicons from '@expo/vector-icons/Ionicons';
import { useState, type ComponentProps } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { ConversationSummary } from '@shared/api';
import { Button, Dialog, Field, Notice } from '@/components/ui';
import { Radius, Spacing, useTheme } from '@/constants/theme';
import { errorMessage } from '@/lib/api';
import { useConversations } from '@/lib/conversations';
import { conversationTitle } from '@/lib/format';
import type { ConversationAction } from './ConversationRow';

const MAX_TITLE_LENGTH = 100;

/**
 * Options, rename and delete for one conversation. Everything happens in one dialog: stacking a
 * second modal or an alert while one is closing is unreliable on iOS.
 */
export function ConversationActions({
  conversation,
  action,
  onClose,
  onDeleted,
}: {
  conversation: ConversationSummary;
  action: ConversationAction;
  onClose(): void;
  onDeleted(): void;
}) {
  const [step, setStep] = useState(action);
  const title = conversationTitle(conversation);
  const heading = { menu: title, rename: 'Rename chat', delete: 'Delete chat?' }[step];

  return (
    <Dialog title={heading} onClose={onClose}>
      {step === 'menu' ? (
        <View>
          <MenuItem icon="create-outline" label="Rename" onPress={() => setStep('rename')} />
          <MenuItem icon="trash-outline" label="Delete" danger onPress={() => setStep('delete')} />
        </View>
      ) : step === 'rename' ? (
        <RenameForm conversation={conversation} onDone={onClose} onCancel={onClose} />
      ) : (
        <DeleteForm conversation={conversation} title={title} onDone={onDeleted} onCancel={onClose} />
      )}
    </Dialog>
  );
}

function MenuItem({
  icon,
  label,
  danger,
  onPress,
}: {
  icon: ComponentProps<typeof Ionicons>['name'];
  label: string;
  danger?: boolean;
  onPress(): void;
}) {
  const theme = useTheme();
  const color = danger ? theme.danger : theme.text;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.menuItem, { backgroundColor: pressed ? theme.surfaceMuted : 'transparent' }]}>
      <Ionicons name={icon} size={20} color={color} />
      <Text style={[styles.menuLabel, { color }]}>{label}</Text>
    </Pressable>
  );
}

function RenameForm({ conversation, onDone, onCancel }: { conversation: ConversationSummary; onDone(): void; onCancel(): void }) {
  const { rename } = useConversations();
  const [title, setTitle] = useState(conversation.title ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = title.trim();
  const changed = trimmed.length > 0 && trimmed !== conversation.title;

  async function save() {
    if (!changed || busy) return;
    setBusy(true);
    setError(null);
    try {
      await rename(conversation.id, trimmed);
      onDone();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <>
      <Field
        label="Name"
        value={title}
        onChangeText={setTitle}
        maxLength={MAX_TITLE_LENGTH}
        autoFocus
        selectTextOnFocus
        returnKeyType="done"
        onSubmitEditing={save}
      />
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <View style={styles.buttons}>
        <Button title="Cancel" kind="secondary" onPress={onCancel} style={styles.flex} />
        <Button title="Save" onPress={save} busy={busy} disabled={!changed} style={styles.flex} />
      </View>
    </>
  );
}

function DeleteForm({
  conversation,
  title,
  onDone,
  onCancel,
}: {
  conversation: ConversationSummary;
  title: string;
  onDone(): void;
  onCancel(): void;
}) {
  const theme = useTheme();
  const { remove } = useConversations();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await remove(conversation.id);
      onDone();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <>
      <Text style={[styles.message, { color: theme.textSecondary }]}>
        “{title}” will be removed from your chat history. Changes the assistant made stay in the audit log.
      </Text>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <View style={styles.buttons}>
        <Button title="Cancel" kind="secondary" onPress={onCancel} style={styles.flex} />
        <Button title="Delete" kind="danger" onPress={confirm} busy={busy} style={styles.flex} />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    minHeight: 48,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.md,
  },
  menuLabel: { fontSize: 16 },
  message: { fontSize: 15, lineHeight: 22 },
  buttons: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.xs },
  flex: { flex: 1 },
});
