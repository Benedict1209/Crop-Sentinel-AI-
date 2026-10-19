import { defineConfig } from 'vitest/config';

// Kept separate from vite.config.ts so the production build never has to load
// the test runner. The suites here exercise application logic (the screening
// merge rules, label mapping, exports, i18n and the store), not rendered trees.
export default defineConfig({
  test: {
    include: ['src/**/__tests__/**/*.test.ts'],
    environment: 'node',
    reporters: ['default'],
  },
});
