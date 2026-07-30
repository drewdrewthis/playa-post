import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { AppShell } from './app/shell/app-shell';

/**
 * Browser entrypoint.
 *
 * Its only job is mounting. Routing, providers, and data wiring belong in
 * `src/app/` (addendum §3) so that this file never becomes the place where
 * unrelated startup concerns accumulate.
 */
const rootElement = document.getElementById('root');

if (rootElement === null) {
  throw new Error('Missing #root element — index.html and entry.tsx are out of sync.');
}

createRoot(rootElement).render(
  <StrictMode>
    <AppShell />
  </StrictMode>,
);
