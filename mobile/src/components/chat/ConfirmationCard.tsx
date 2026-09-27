import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { ConfirmationChange, ConfirmationPart } from '@shared/api';
import { Button } from '@/components/ui';
import { Radius, Spacing, useTheme, type Theme } from '@/constants/theme';
import { STATUS_LABEL } from '@/lib/format';
import { StatusIcon } from './StatusIcon';
import { usePassed } from './usePassed';

type Decision = 'confirm' | 'cancel';
type Outcome = Exclude<ConfirmationPart['status'], 'pending'>;

const OUTCOMES: Record<Outcome, { label: string; icon: ComponentProps<typeof Ionicons>['name']; color: (theme: Theme) => string }> = {
  confirmed: { label: 'Confirmed', icon: 'checkmark-circle', color: (theme) => theme.success },
  cancelled: { label: 'Cancelled', icon: 'close-circle', color: (theme) => theme.textSecondary },
  expired: { label: 'Expired', icon: 'time-outline', color: (theme) => theme.warning },
};

/**
 * Changes the assistant proposed. While they wait, the person confirms or cancels them here (only on the
 * latest card); afterwards the card shows the decision and how each change went. Once the time to confirm
 * has run out, the card shows it has expired: the server records that only when the card is answered.
 */
export function ConfirmationCard({
  part,
  answerable,
  deciding,
  disabled,
  onDecide,
}: {
  part: ConfirmationPart;
  /** The latest confirmation, still waiting for the person. */
  answerable: boolean;
  /** The answer being sent for this card. */
  deciding: Decision | null;
  /** Another request is running. */
  disabled: boolean;
  onDecide(decision: Decision): void;
}) {
  const theme = useTheme();
  // An answer already on its way is for the server to judge.
  const expired = usePassed(part.status === 'pending' && !deciding ? part.expiresAt : null);
  const status: ConfirmationPart['status'] = expired ? 'expired' : part.status;
  const count = part.changes.length;
  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]} accessibilityLiveRegion="polite">
      <View style={styles.header}>
        <Ionicons name="shield-checkmark-outline" size={20} color={theme.accent} />
        <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>
          {count === 1 ? 'Confirm this change' : `Confirm these ${count} changes`}
        </Text>
      </View>
      {part.changes.map((change) => (
        <Change key={change.id} change={change} />
      ))}
      {status === 'pending' ? (
        answerable ? (
          <>
            <Text style={[styles.hint, { color: theme.textSecondary }]}>
              Nothing changes until you confirm. You can also say “confirm” or “cancel”.
            </Text>
            <View style={styles.buttons}>
              <Button
                title="Cancel"
                kind="secondary"
                onPress={() => onDecide('cancel')}
                busy={deciding === 'cancel'}
                disabled={disabled}
                style={styles.button}
              />
              <Button title="Confirm" onPress={() => onDecide('confirm')} busy={deciding === 'confirm'} disabled={disabled} style={styles.button} />
            </View>
          </>
        ) : null
      ) : (
        <OutcomeRow outcome={status} />
      )}
    </View>
  );
}

function Change({ change }: { change: ConfirmationChange }) {
  const theme = useTheme();
  const decided = change.status !== 'awaiting_confirmation';
  return (
    <View style={[styles.change, { backgroundColor: theme.surfaceMuted }]}>
      <Text style={[styles.system, { color: theme.textSecondary }]}>{change.system}</Text>
      <Text style={[styles.summary, { color: theme.text }]}>{change.summary}</Text>
      {decided ? (
        <View style={styles.status}>
          <StatusIcon status={change.status} />
          <Text style={[styles.statusLabel, { color: theme.textSecondary }]}>{STATUS_LABEL[change.status]}</Text>
        </View>
      ) : null}
      {decided && change.error ? <Text style={[styles.error, { color: change.status === 'failed' ? theme.danger : theme.textSecondary }]}>{change.error}</Text> : null}
    </View>
  );
}

function OutcomeRow({ outcome }: { outcome: Outcome }) {
  const theme = useTheme();
  const { label, icon, color } = OUTCOMES[outcome];
  return (
    <View style={styles.status}>
      <Ionicons name={icon} size={18} color={color(theme)} />
      <Text style={[styles.outcome, { color: color(theme) }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: Radius.lg, padding: Spacing.lg, gap: Spacing.sm, marginVertical: Spacing.xs },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  title: { fontSize: 16, fontWeight: '700' },
  change: { borderRadius: Radius.md, padding: Spacing.md, gap: 2 },
  system: { fontSize: 12, fontWeight: '600' },
  summary: { fontSize: 15, lineHeight: 21 },
  status: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, marginTop: Spacing.xs },
  statusLabel: { fontSize: 13 },
  error: { fontSize: 13, lineHeight: 18 },
  hint: { fontSize: 13, lineHeight: 18 },
  buttons: { flexDirection: 'row', gap: Spacing.sm },
  button: { flex: 1 },
  outcome: { fontSize: 14, fontWeight: '600' },
});
