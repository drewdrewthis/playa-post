import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { ApiProvider } from './app/api/api-provider';
import { SessionProvider } from './app/auth/session-provider';
import { AppRouter } from './app/router';
import { ThemeProvider } from './app/theme/theme-provider';

import './app/pwa/register-service-worker';
import './app/theme/typefaces';
import './app/theme/tokens.css';
import './app/theme/screens.css';

/**
 * Browser entrypoint.
 *
 * Its only job is mounting. The provider order is the dependency order and is not
 * arbitrary: the API client reads the access token, so the session has to exist above
 * it; the router's route guards call the API, so the API has to exist above them.
 * `ThemeProvider` sits outermost because it depends on nothing — the theme applies to
 * the sign-in screen and to a session-restore spinner just as much as to the app.
 *
 * The three stylesheets are loaded here rather than by whichever component happens to
 * need them first: `screens.css` styles screens on both sides of the shell (sign-in and
 * onboarding render outside it), and a stylesheet reached only through the shell's own
 * import would leave those two silently unstyled if the shell ever stopped importing it.
 *
 * `register-service-worker` is imported for the same reason — a side effect that must
 * run regardless of which screen mounts first. The import itself is the fix: it is what
 * turns `injectRegister: 'auto'` (`vite.config.ts`) away from the plugin's dumb
 * registration script and onto the client that actually reaches an already-open tab.
 * See that module for why.
 */
const rootElement = document.getElementById('root');

if (rootElement === null) {
  throw new Error('Missing #root element — index.html and entry.tsx are out of sync.');
}

createRoot(rootElement).render(
  <StrictMode>
    <ThemeProvider>
      <SessionProvider>
        <ApiProvider>
          <AppRouter />
        </ApiProvider>
      </SessionProvider>
    </ThemeProvider>
  </StrictMode>,
);
