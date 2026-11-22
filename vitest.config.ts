import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Whole-system tests seed a full demo business; under parallel load a single test can pass 5s.
  test: { include: ['tests/**/*.test.ts'], environment: 'node', testTimeout: 20_000 },
});
