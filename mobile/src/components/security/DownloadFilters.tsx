import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useEffect, useState, type ComponentProps } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { AccountSummary } from '@shared/api';
import { Button, Dialog, Notice } from '@/components/ui';
import { Radius, Spacing, useTheme } from '@/constants/theme';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { PERIODS, periodLabel, samePeriod, type Period } from './periods';

interface People {
  accounts: AccountSummary[] | null;
  error: string | null;
  retry(): void;
}

/** The person and period filters of the downloads list: each a button that opens its choices. */
export function DownloadFilters({
  personId,
  onPersonChange,
  period,
  onPeriodChange,
}: {
  /** Null for everyone. */
  personId: string | null;
  onPersonChange(personId: string | null): void;
  period: Period;
  onPeriodChange(period: Period): void;
}) {
  const people = usePeople();
  const [picking, setPicking] = useState<'person' | 'period' | null>(null);
  const personName = personId ? (people.accounts?.find((account) => account.id === personId)?.displayName ?? 'One person') : 'Everyone';
  // A week chosen from a weekly report stays on offer next to the usual periods.
  const periods = period.kind === 'week' ? [period, ...PERIODS] : PERIODS;

  function choosePerson(id: string | null) {
    setPicking(null);
    onPersonChange(id);
  }

  function choosePeriod(option: Period) {
    setPicking(null);
    onPeriodChange(option);
  }

  return (
    <View style={styles.filters}>
      <FilterButton icon="person-outline" name="Person" value={personName} onPress={() => setPicking('person')} />
      <FilterButton icon="calendar-outline" name="Period" value={periodLabel(period)} onPress={() => setPicking('period')} />
      {picking === 'person' ? (
        <Dialog title="Show downloads by" onClose={() => setPicking(null)}>
          <PersonChoices people={people} selected={personId} onChoose={choosePerson} />
        </Dialog>
      ) : null}
      {picking === 'period' ? (
        <Dialog title="Show downloads from" onClose={() => setPicking(null)}>
          <ScrollView accessibilityRole="radiogroup" accessibilityLabel="Period" style={styles.choices}>
            {periods.map((option) => (
              <Choice
                key={periodLabel(option)}
                label={periodLabel(option)}
                selected={samePeriod(option, period)}
                onPress={() => choosePeriod(option)}
              />
            ))}
          </ScrollView>
        </Dialog>
      ) : null}
    </View>
  );
}

/** Everyone who has an account, for the person filter. */
function usePeople(): People {
  const { call } = useAuth();
  const [accounts, setAccounts] = useState<AccountSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const loaded = await call((token) => api.accounts(token));
      setAccounts([...loaded].sort((a, b) => a.displayName.localeCompare(b.displayName)));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [call]);

  useEffect(() => {
    void load();
  }, [load]);

  return { accounts, error, retry: () => void load() };
}

function PersonChoices({ people, selected, onChoose }: { people: People; selected: string | null; onChoose(personId: string | null): void }) {
  const theme = useTheme();
  if (!people.accounts) {
    return people.error ? (
      <>
        <Notice tone="danger">{people.error}</Notice>
        <Button title="Try again" kind="secondary" onPress={people.retry} />
      </>
    ) : (
      <ActivityIndicator color={theme.accent} style={styles.loading} />
    );
  }
  return (
    <ScrollView accessibilityRole="radiogroup" accessibilityLabel="Person" style={styles.choices}>
      <Choice label="Everyone" selected={selected === null} onPress={() => onChoose(null)} />
      {people.accounts.map((account) => (
        <Choice
          key={account.id}
          label={account.displayName}
          detail={account.username}
          selected={account.id === selected}
          onPress={() => onChoose(account.id)}
        />
      ))}
    </ScrollView>
  );
}

function FilterButton({
  icon,
  name,
  value,
  onPress,
}: {
  icon: ComponentProps<typeof Ionicons>['name'];
  name: string;
  value: string;
  onPress(): void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${name}: ${value}`}
      accessibilityHint="Changes which downloads are shown"
      onPress={onPress}
      style={({ pressed }) => [styles.filter, { borderColor: theme.border, backgroundColor: pressed ? theme.surfaceMuted : theme.surface }]}>
      <Ionicons name={icon} size={16} color={theme.textSecondary} />
      <Text numberOfLines={1} style={[styles.filterValue, { color: theme.text }]}>
        {value}
      </Text>
      <Ionicons name="chevron-down" size={14} color={theme.textSecondary} />
    </Pressable>
  );
}

function Choice({ label, detail, selected, onPress }: { label: string; detail?: string; selected: boolean; onPress(): void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      aria-checked={selected}
      accessibilityLabel={detail ? `${label}, ${detail}` : label}
      onPress={onPress}
      style={({ pressed }) => [styles.choice, { backgroundColor: pressed ? theme.surfaceMuted : 'transparent' }]}>
      <Ionicons
        name={selected ? 'radio-button-on' : 'radio-button-off'}
        size={22}
        color={selected ? theme.accent : theme.textSecondary}
      />
      <View style={styles.flex}>
        <Text numberOfLines={1} style={[styles.choiceLabel, { color: theme.text }]}>
          {label}
        </Text>
        {detail ? (
          <Text numberOfLines={1} style={[styles.choiceDetail, { color: theme.textSecondary }]}>
            {detail}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  filter: {
    flexGrow: 1,
    flexBasis: 140,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    minHeight: 40,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  filterValue: { flex: 1, fontSize: 14, fontWeight: '600' },
  choices: { maxHeight: 360, flexGrow: 0 },
  choice: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, minHeight: 48, paddingHorizontal: Spacing.sm, borderRadius: Radius.md },
  choiceLabel: { fontSize: 15 },
  choiceDetail: { fontSize: 13 },
  flex: { flex: 1 },
  loading: { marginVertical: Spacing.lg },
});
