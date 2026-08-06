import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { ApiProvider } from './app/api/api-provider';
import { SessionProvider } from './app/auth/session-provider';
import { AppRouter } from './app/router';

import './app/theme/tokens.css';

/**
 * Browser entrypoint.
 *
 * Its only job is mounting. The provider order is the dependency order and is not
 * arbitrary: the API client reads the access token, so the session has to exist above
 * it; the router's route guards call the API, so the API has to exist above them.
 */
const rootElement = document.getElementById('root');

if (rootElement === null) {
  throw new Error('Missing #root element — index.html and entry.tsx are out of sync.');
}

createRoot(rootElement).render(
  <StrictMode>
    <SessionProvider>
      <ApiProvider>
        <AppRouter />
      </ApiProvider>
    </SessionProvider>
  </StrictMode>,
);
