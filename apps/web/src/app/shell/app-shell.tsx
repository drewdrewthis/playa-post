import { useState, type JSX } from 'react';
import { Outlet } from 'react-router';

import { NotificationsBell } from '../notifications/notifications-bell';
import { NotificationsPanel } from '../notifications/notifications-panel';
import { OfflinePendingBadge } from '../offline/pending-badge';
import { ThemeToggle } from '../theme/theme-toggle';

import { AddChooser } from './add-chooser';
import { TabBar } from './tab-bar';
import { WelcomeInvitePopup } from './welcome-invite-popup';

import './app-shell.css';

/**
 * The application shell: the frame that persists across every authenticated screen.
 *
 * The comp's chrome, in three pieces — the wordmark and the icon cluster on top, the
 * screen in the middle, the tab bar and compose FAB on the bottom. Everything here is
 * true everywhere and nowhere in particular: navigation, the theme choice, the
 * notifications bell, and the offline queue strip. The strip in particular has to be
 * outside any one screen — a write queued on the board must stay visible after
 * navigating to the graph, or the user loses track of it.
 *
 * The notifications overlay's open state lives here rather than inside the bell,
 * because the overlay is a sibling of the tab bar and the bell is not: `inset: 0` has
 * to resolve against the column so the panel covers the tabs, the way the comp draws
 * it.
 *
 * Mobile-first and one column wide at every viewport. On a desktop it is centred with
 * the desk colour around it — the comp's phone width without the comp's phone (see
 * `screens.css`).
 */
export function AppShell(): JSX.Element {
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [addChooserOpen, setAddChooserOpen] = useState(false);

  return (
    <div className="app-frame">
      <div className="app-column">
        <header className="app-chrome">
          <p className="wordmark">The Playa Post</p>

          <div className="app-chrome__actions">
            <NotificationsBell
              open={notificationsOpen}
              onToggle={() => setNotificationsOpen((previous) => !previous)}
            />
            <ThemeToggle />
          </div>
        </header>

        <OfflinePendingBadge />

        <main className="app-shell__main">
          <Outlet />
        </main>

        <TabBar
          onAdd={() => {
            setAddChooserOpen(true);
          }}
        />

        {notificationsOpen ? (
          <NotificationsPanel
            onClose={() => {
              setNotificationsOpen(false);
            }}
          />
        ) : null}

        {/* Self-gating (issue #220): decides for itself whether this visit gets the
            welcome, so the shell holds no invite-hint policy. */}
        <WelcomeInvitePopup />

        {/* The FAB's chooser (issue #221) — its open state lives here for the same
            `inset: 0` reason the notifications overlay's does. */}
        {addChooserOpen ? (
          <AddChooser
            onClose={() => {
              setAddChooserOpen(false);
            }}
          />
        ) : null}
      </div>
    </div>
  );
}
