import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// FROZEN FILE — integration lead only. See CLAUDE.md § Frozen files.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@contracts': r('./src/contracts'),
      '@core': r('./src/core'),
      '@world': r('./src/world'),
      '@ecology': r('./src/ecology'),
      '@creatures': r('./src/creatures'),
      '@player': r('./src/player'),
      '@society': r('./src/society'),
      '@presentation': r('./src/presentation'),
    },
  },
  server: { port: 5173 },
  build: { target: 'es2022', sourcemap: true },
});
