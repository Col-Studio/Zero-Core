import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

// FROZEN FILE — integration lead only. See CLAUDE.md § Frozen files.
// Inherits the path aliases from vite.config.ts so tests import exactly like src does.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'node',
      include: ['tests/unit/**/*.test.ts', 'src/**/*.test.ts'],
      exclude: ['tests/e2e/**', 'node_modules/**'],
      // Simulation tests can run long tick counts; keep headroom for fuzz/soak tests.
      testTimeout: 30_000,
      coverage: {
        reporter: ['text', 'html'],
        include: ['src/**/*.ts'],
        exclude: [
          'src/**/dev/**',
          'src/**/*.data.ts',
          'src/**/*.d.ts',
          // Type-only files compile to nothing, so v8 scores them 0% and drags the real number
          // down. Excluding them keeps the ≥80% gate honest instead of decorative.
          'src/contracts/services.ts',
          'src/contracts/events/**',
        ],
        thresholds: { statements: 80, branches: 80, functions: 80, lines: 80 },
      },
    },
  }),
);
