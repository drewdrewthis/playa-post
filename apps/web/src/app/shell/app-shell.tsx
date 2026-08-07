import type { JSX } from 'react';
import { NavLink, Outlet } from 'react-router';

import { useSession } from '../auth/session-provider';
import { NotificationsPanel } from '../notifications/notifications-panel';
import { OfflinePendingBadge } from '../offline/pending-badge';

import './app-shell.css';

/**
 * The application shell: the frame that persists across every route.
 *
 * Three things live here because they are true everywhere and nowhere in particular —
 * navigation, the notifications bell, and the offline queue badge. The badge in
 * particular has to be outside any one screen: a write queued on the board must stay
 * visible after navigating to the graph, or the user loses track of it.
 */
export function AppShell(): JSX.Element {
  const { signOut } = useSession();

  return (
    <div className="app-shell">
      <header className="app-shell__header">
        <p className="wordmark">The Playa Post</p>

        <nav className="app-shell__nav">
          <NavLink to="/graph">Graph</NavLink>
          <NavLink to="/board">Board</NavLink>
        </nav>

        <div className="app-shell__status">
          <OfflinePendingBadge />
          <NotificationsPanel />
          <button
            className="button button--quiet"
            type="button"
            onClick={() => {
              void signOut();
            }}
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="app-shell__main">
        <Outlet />
      </main>
    </div>
  );
}
