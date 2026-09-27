import { useEffect, useState } from 'react';
import { Animated, Easing, Platform } from 'react-native';

/** A value that runs from 0 to 1 over `durationMs`, again and again, while the component is shown. */
export function useLoop(durationMs: number): Animated.Value {
  const [progress] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(progress, {
        toValue: 1,
        duration: durationMs,
        easing: Easing.linear,
        // Browsers have no native animation driver.
        useNativeDriver: Platform.OS !== 'web',
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [progress, durationMs]);
  return progress;
}
