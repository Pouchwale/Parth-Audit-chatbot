import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, TextInput, View, type ViewStyle } from 'react-native';
import { Radius, Spacing, useColorSchemeSetting, useTheme } from '@/constants/theme';

/** A search box with a clear button. `label` is its placeholder and what screen readers call it. */
export function SearchField({
  label,
  value,
  onChangeText,
  maxLength,
  style,
}: {
  label: string;
  value: string;
  onChangeText(text: string): void;
  maxLength?: number;
  style?: ViewStyle;
}) {
  const theme = useTheme();
  const scheme = useColorSchemeSetting();
  return (
    <View style={[styles.box, { backgroundColor: theme.surfaceMuted }, style]}>
      <Ionicons name="search" size={16} color={theme.textSecondary} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={label}
        placeholderTextColor={theme.textSecondary}
        accessibilityLabel={label}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        maxLength={maxLength}
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
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.md,
  },
  input: { flex: 1, minHeight: 40, fontSize: 15 },
});
