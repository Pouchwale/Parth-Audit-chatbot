import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Avatar } from '@/components/ui';
import { Radius, Spacing, useTheme } from '@/constants/theme';
import { useAuth } from '@/lib/auth';
import { ROLE_LABEL } from '@/lib/format';

export function DrawerFooter({
  onOpenSettings,
  onOpenAccounts,
  onOpenSecurity,
}: {
  onOpenSettings(): void;
  onOpenAccounts(): void;
  onOpenSecurity(): void;
}) {
  const theme = useTheme();
  const { user } = useAuth();
  if (!user) return null;

  return (
    <View style={[styles.footer, { borderTopColor: theme.border }]}>
      {user.role === 'super_admin' ? (
        <View style={styles.adminLinks}>
          <AdminLink icon="people-outline" label="Accounts" onPress={onOpenAccounts} />
          <AdminLink icon="shield-checkmark-outline" label="Security" onPress={onOpenSecurity} />
        </View>
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

function AdminLink({ icon, label, onPress }: { icon: ComponentProps<typeof Ionicons>['name']; label: string; onPress(): void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.row, styles.adminLink, { backgroundColor: pressed ? theme.surfaceMuted : 'transparent' }]}>
      <Ionicons name={icon} size={20} color={theme.text} />
      <Text numberOfLines={1} style={[styles.label, { color: theme.text }]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  footer: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: Spacing.sm, paddingVertical: Spacing.sm, gap: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, minHeight: 48, paddingHorizontal: Spacing.md, borderRadius: Radius.md },
  adminLinks: { flexDirection: 'row', gap: 2 },
  adminLink: { flex: 1, gap: Spacing.sm },
  label: { flexShrink: 1, fontSize: 15 },
  person: { flex: 1 },
  name: { fontSize: 15, fontWeight: '600' },
  role: { fontSize: 13 },
});
