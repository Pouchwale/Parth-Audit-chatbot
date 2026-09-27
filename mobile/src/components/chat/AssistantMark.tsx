import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, View } from 'react-native';
import { useTheme } from '@/constants/theme';

/** The assistant's small round mark, beside its replies and on the welcome screen. */
export function AssistantMark({ size = 28 }: { size?: number }) {
  const theme = useTheme();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.mark, { width: size, height: size, borderRadius: size / 2, backgroundColor: theme.accentSoft }]}>
      <Ionicons name="sparkles" size={Math.round(size * 0.55)} color={theme.accent} />
    </View>
  );
}

const styles = StyleSheet.create({
  mark: { alignItems: 'center', justifyContent: 'center' },
});
