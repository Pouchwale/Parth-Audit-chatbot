import { useEffect, useState } from 'react';

// Timers fire at once when set for longer than this; a later deadline is checked again after it.
const MAX_TIMER_MS = 2 ** 31 - 1;

/** Whether `deadline` (an ISO date) has passed, updating when it does. Null means there is no deadline. */
export function usePassed(deadline: string | null): boolean {
  const at = deadline === null ? Infinity : Date.parse(deadline);
  const [now, setNow] = useState(Date.now);
  const passed = now >= at;
  useEffect(() => {
    if (passed || !Number.isFinite(at)) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.min(at - Date.now(), MAX_TIMER_MS));
    return () => clearTimeout(timer);
  }, [at, passed, now]);
  return passed;
}
