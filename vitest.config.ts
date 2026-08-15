import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

// FROZEN FILE — integration lead only. See CLAUDE.md § Frozen files.
// Inherits the path aliases from vite.config.ts so tests import exactly like src does.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'node',
      // CLAUDE.md § Hard invariants 7 tells every member to put tests in `tests/<their-folder>/`.
      // This pattern must match that or their tests are silently never collected: `npm run test`
      // reports a confident green from someone else's suite, and the coverage gate then fails
      // their module at 0% for a reason the message does not explain. Measured — it happened.
      //
      // Convention: *.test.ts is Vitest, *.spec.ts is Playwright. Anywhere under tests/.
      include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
      exclude: ['tests/e2e/**', '**/*.spec.ts', 'node_modules/**'],
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
