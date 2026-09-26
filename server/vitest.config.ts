import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The first test in each file starts an embedded Postgres, which can take several seconds.
    hookTimeout: 60_000,
  },
});
