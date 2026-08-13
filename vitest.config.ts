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
        exclude: ['src/**/dev/**', 'src/**/*.data.ts', 'src/**/*.d.ts'],
      },
    },
  }),
);
