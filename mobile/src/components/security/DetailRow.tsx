import { StyleSheet, Text, View } from 'react-native';
import { MONOSPACE } from '@/components/chat/CodeBlock';
import { Spacing, useTheme } from '@/constants/theme';
import { CopyButton } from './CopyButton';

/** A recorded fact: its name above its value, which can be selected, and copied with a button when `copyLabel` is set. */
export function DetailRow({
  label,
  value,
  copyLabel,
  monospace = false,
}: {
  label: string;
  value: string;
  /** What the copy button says to screen readers, e.g. "Copy fingerprint". */
  copyLabel?: string;
  /** For IDs and fingerprints, where every character counts. */
  monospace?: boolean;
}) {
  const theme = useTheme();
  return (
    <View style={styles.row}>
      <View style={styles.text}>
        <Text style={[styles.label, { color: theme.textSecondary }]}>{label}</Text>
        <Text selectable style={[styles.value, { color: theme.text }, monospace && styles.monospace]}>
          {value}
        </Text>
      </View>
      {copyLabel ? <CopyButton text={value} label={copyLabel} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.xs },
  text: { flex: 1, gap: 2 },
  label: { fontSize: 12, fontWeight: '600' },
  value: { fontSize: 15, lineHeight: 21 },
  monospace: { fontFamily: MONOSPACE, fontSize: 13, lineHeight: 19 },
});
