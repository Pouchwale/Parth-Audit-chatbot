import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The first test in each file starts an embedded Postgres, which can take several seconds.
    hookTimeout: 60_000,
    // Files run side by side, so on a busy 4-core PC a test that makes sixty requests, or parses 400 replies at every
    // stage of their streaming, can take several times its usual second or two. Only a test that hangs should run out
    // of time.
    testTimeout: 60_000,
  },
});
