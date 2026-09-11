import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 60_000,
    hookTimeout: 180_000,
    include: ['test/**/*.test.ts'],
    fileParallelism: false,
  },
});