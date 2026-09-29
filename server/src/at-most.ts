/**
 * Runs tasks at most `max` at a time. A task started while that many are running waits for one of them to finish, and
 * waiting tasks start in the order they came.
 */
export function atMost(max: number): <T>(task: () => Promise<T>) => Promise<T> {
  let running = 0;
  const waiting: (() => void)[] = [];
  return async (task) => {
    if (running < max) running++;
    else await new Promise<void>((resolve) => waiting.push(resolve));
    try {
      return await task();
    } finally {
      // The place passes straight to the next in line, or is given back.
      const next = waiting.shift();
      if (next) next();
      else running--;
    }
  };
}
