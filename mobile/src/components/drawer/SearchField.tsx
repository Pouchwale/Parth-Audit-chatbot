import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Radius, Spacing, useColorSchemeSetting, useTheme } from '@/constants/theme';

export function SearchField({ value, onChangeText }: { value: string; onChangeText(text: string): void }) {
  const theme = useTheme();
  const scheme = useColorSchemeSetting();
  return (
    <View style={[styles.box, { backgroundColor: theme.surfaceMuted }]}>
      <Ionicons name="search" size={16} color={theme.textSecondary} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder="Search chats"
        placeholderTextColor={theme.textSecondary}
        accessibilityLabel="Search chats"
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        keyboardAppearance={scheme}
        style={[styles.input, { color: theme.text }]}
      />
      {value ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => onChangeText('')} hitSlop={8}>
          <Ionicons name="close-circle" size={18} color={theme.textSecondary} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    minHeight: 40,
    marginHorizontal: Spacing.md,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.md,
  },
  input: { flex: 1, minHeight: 40, fontSize: 15 },
});
