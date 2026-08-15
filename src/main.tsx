/**
 * FROZEN — integration lead only. See CLAUDE.md § Frozen files.
 *
 * Entry point. Deliberately thin — all wiring lives in App.tsx.
 *
 * StrictMode is intentionally OFF: its double-invocation of effects would mount every module
 * twice, which for imperative three.js modules means duplicated meshes, duplicated event
 * listeners, and a doubled simulation. Determinism matters more here than the extra checks.
 */

import { createRoot } from 'react-dom/client';
import App from './App';

const container = document.getElementById('root');
if (container === null) throw new Error('#root not found in index.html');

createRoot(container).render(<App />);
