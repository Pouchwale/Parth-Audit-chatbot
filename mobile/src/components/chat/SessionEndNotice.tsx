import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Notice } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth';
import { minutesLeft, nextLook, sessionEndWords } from '@/lib/session-end';

// Timers fire at once when set for longer than this; a later look is made again after it.
const MAX_TIMER_MS = 2 ** 31 - 1;

/**
 * Ten minutes before the session ends (DCRS ends it with the staff's hours, and at midnight for the super admin), says
 * so above the composer and counts down. One timer, set for when the warning is due: nothing runs until then.
 */
export function SessionEndNotice() {
  const { endsAt, user } = useAuth();
  const [now, setNow] = useState(Date.now);
  const wait = nextLook(endsAt, now);
  useEffect(() => {
    if (wait === null) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.min(Math.max(wait, 1000), MAX_TIMER_MS));
    return () => clearTimeout(timer);
  }, [wait, now]);
  const minutes = minutesLeft(endsAt, now);
  if (!endsAt || minutes === null) return null;
  return (
    <View style={styles.notice} accessibilityLiveRegion="polite">
      <Notice>{sessionEndWords(endsAt, minutes, user?.role === 'super_admin')}</Notice>
    </View>
  );
}

const styles = StyleSheet.create({
  notice: { paddingHorizontal: Spacing.md, paddingBottom: Spacing.sm },
});
