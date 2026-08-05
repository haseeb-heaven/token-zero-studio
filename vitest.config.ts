import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/core/**', 'src/shared/**', 'src/renderer/**'],
      reporter: ['text', 'html'],
      // Electron main/preload require runtime APIs not exercisable in vitest.
      exclude: ['src/main/**', 'src/preload/**', '**/*.d.ts'],
      thresholds: {
        statements: 90,
        branches: 70, // xterm terminal bridge (real PTY I/O) is not exercisable in jsdom
        functions: 90,
        lines: 90,
      },
    },
  },
});
