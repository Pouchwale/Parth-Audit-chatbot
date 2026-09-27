import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Avatar } from '@/components/ui';
import { Radius, Spacing, useTheme } from '@/constants/theme';
import { useAuth } from '@/lib/auth';
import { ROLE_LABEL } from '@/lib/format';

export function DrawerFooter({ onOpenSettings, onOpenAccounts }: { onOpenSettings(): void; onOpenAccounts(): void }) {
  const theme = useTheme();
  const { user } = useAuth();
  if (!user) return null;

  return (
    <View style={[styles.footer, { borderTopColor: theme.border }]}>
      {user.role === 'super_admin' ? (
        <Pressable
          accessibilityRole="button"
          onPress={onOpenAccounts}
          style={({ pressed }) => [styles.row, { backgroundColor: pressed ? theme.surfaceMuted : 'transparent' }]}>
          <Ionicons name="people-outline" size={20} color={theme.text} />
          <Text style={[styles.label, { color: theme.text }]}>Accounts</Text>
        </Pressable>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Settings. Signed in as ${user.displayName}, ${ROLE_LABEL[user.role]}`}
        onPress={onOpenSettings}
        style={({ pressed }) => [styles.row, { backgroundColor: pressed ? theme.surfaceMuted : 'transparent' }]}>
        <Avatar name={user.displayName} size={32} />
        <View style={styles.person}>
          <Text numberOfLines={1} style={[styles.name, { color: theme.text }]}>
            {user.displayName}
          </Text>
          <Text numberOfLines={1} style={[styles.role, { color: theme.textSecondary }]}>
            {ROLE_LABEL[user.role]}
          </Text>
        </View>
        <Ionicons name="settings-outline" size={20} color={theme.textSecondary} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  footer: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: Spacing.sm, paddingVertical: Spacing.sm, gap: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, minHeight: 48, paddingHorizontal: Spacing.md, borderRadius: Radius.md },
  label: { fontSize: 15 },
  person: { flex: 1 },
  name: { fontSize: 15, fontWeight: '600' },
  role: { fontSize: 13 },
});
