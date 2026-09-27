import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Radius, Spacing, useTheme } from '@/constants/theme';
import { useAuth } from '@/lib/auth';
import { AssistantMark } from './AssistantMark';
import { useSuggestions, type SuggestionsState } from './useSuggestions';

const PLACEHOLDER_CARDS = 3;

function greeting(hour: number): string {
  if (hour >= 5 && hour < 12) return 'Good morning';
  if (hour >= 12 && hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/** A new chat: a greeting, and suggestions to start from. Tapping one sends it. */
export function Welcome({ onPick }: { onPick(text: string): void }) {
  const theme = useTheme();
  const { user } = useAuth();
  const suggestions = useSuggestions();
  const firstName = user?.displayName.trim().split(/\s+/)[0];
  const hello = greeting(new Date().getHours());

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <AssistantMark size={44} />
      <Text accessibilityRole="header" style={[styles.greeting, { color: theme.text }]}>
        {firstName ? `${hello}, ${firstName}` : hello}
      </Text>
      <Text style={[styles.subtitle, { color: theme.textSecondary }]}>Ask me to look something up or make a change.</Text>
      <Suggestions state={suggestions} onPick={onPick} />
    </ScrollView>
  );
}

function Suggestions({ state, onPick }: { state: SuggestionsState; onPick(text: string): void }) {
  const theme = useTheme();
  if (state.status === 'failed') {
    return (
      <Pressable accessibilityRole="button" onPress={state.retry} hitSlop={8} style={styles.retry}>
        <Ionicons name="refresh" size={15} color={theme.textSecondary} />
        <Text style={[styles.retryText, { color: theme.textSecondary }]}>Suggestions didn't load. Tap to try again.</Text>
      </Pressable>
    );
  }
  if (state.status === 'loading') {
    return (
      <View accessible accessibilityLabel="Loading suggestions" style={styles.cards}>
        {Array.from({ length: PLACEHOLDER_CARDS }, (_, index) => (
          <View key={index} style={[styles.card, { backgroundColor: theme.surfaceMuted, borderColor: theme.surfaceMuted }]} />
        ))}
      </View>
    );
  }
  return (
    <View style={styles.cards}>
      {state.suggestions.map((suggestion) => (
        <Pressable
          key={suggestion.text}
          accessibilityRole="button"
          accessibilityLabel={suggestion.text}
          accessibilityHint="Sends this request"
          onPress={() => onPick(suggestion.text)}
          style={({ pressed }) => [styles.card, { backgroundColor: pressed ? theme.surfaceMuted : theme.surface, borderColor: theme.border }]}>
          <Text style={[styles.cardText, { color: theme.text }]} numberOfLines={2}>
            {suggestion.text}
          </Text>
          <Text style={[styles.cardSystem, { color: theme.textSecondary }]} numberOfLines={1}>
            {suggestion.system}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: Spacing.xl, gap: Spacing.md },
  greeting: { fontSize: 28, lineHeight: 34, fontWeight: '600', textAlign: 'center', marginTop: Spacing.sm },
  subtitle: { fontSize: 16, lineHeight: 22, textAlign: 'center' },
  cards: { width: '100%', maxWidth: 480, gap: Spacing.sm, marginTop: Spacing.lg },
  card: { minHeight: 64, borderWidth: 1, borderRadius: Radius.lg, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md, gap: 2, justifyContent: 'center' },
  cardText: { fontSize: 15, lineHeight: 21 },
  cardSystem: { fontSize: 12 },
  retry: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, marginTop: Spacing.lg },
  retryText: { fontSize: 14 },
});
