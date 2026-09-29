import { expect, it } from 'vitest';
import { atMost } from '../src/at-most.ts';

it('runs no more than the given number of tasks at once, starting the rest in order as places free up', async () => {
  const run = atMost(2);
  const started: number[] = [];
  const finish = new Map<number, () => void>();
  const task = (n: number) =>
    run(() => {
      started.push(n);
      return new Promise<void>((resolve) => finish.set(n, resolve));
    });
  const tasks = [task(1), task(2), task(3), task(4)];
  expect(started).toEqual([1, 2]);

  finish.get(2)!();
  await tasks[1];
  expect(started).toEqual([1, 2, 3]);
  finish.get(1)!();
  await tasks[0];
  expect(started).toEqual([1, 2, 3, 4]);
  finish.get(3)!();
  finish.get(4)!();
  await Promise.all(tasks);
});

it('frees the place of a task that fails', async () => {
  const run = atMost(1);
  await expect(
    run(async () => {
      throw new Error('boom');
    }),
  ).rejects.toThrow('boom');
  expect(await run(async () => 'next')).toBe('next');
});
