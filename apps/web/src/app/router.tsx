import type { JSX } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router';

import { RequireSession } from './auth/require-session';
import { OfflineProvider } from './offline/offline-provider';
import { BoardRoute } from './routes/board';
import { ComposeBulletinRoute } from './routes/compose-bulletin';
import { GraphHomeRoute } from './routes/graph-home';
import { InviteOpenRoute } from './routes/invite-open';
import { OnboardingRoute } from './routes/onboarding';
import { PersonSheetRoute } from './routes/person-sheet';
import { SignInRoute } from './routes/sign-in';
import { AppShell } from './shell/app-shell';

/**
 * Everything behind sign-in, with the shell and the offline queue around it.
 *
 * `OfflineProvider` is inside `RequireSession` on purpose: the drainer replays writes
 * as the signed-in actor, and starting it before there is a session would fire a
 * batch of unauthenticated `sync.submitMutations` calls on every cold start.
 */
function ProtectedLayout(): JSX.Element {
  return (
    <RequireSession>
      <OfflineProvider>
        <AppShell />
      </OfflineProvider>
    </RequireSession>
  );
}

/**
 * `/graph` is a second path to graph home rather than a redirect: it is the URL the
 * app navigates to from the shell, and a redirect would put an extra history entry
 * between a person sheet and the graph a user came from.
 */
const router = createBrowserRouter([
  { path: '/signin', element: <SignInRoute /> },
  {
    element: <ProtectedLayout />,
    children: [
      { path: '/onboarding', element: <OnboardingRoute /> },
      { path: '/', element: <GraphHomeRoute /> },
      { path: '/graph', element: <GraphHomeRoute /> },
      { path: '/invite/:token', element: <InviteOpenRoute /> },
      { path: '/people/:userId', element: <PersonSheetRoute /> },
      { path: '/board', element: <BoardRoute /> },
      { path: '/board/new', element: <ComposeBulletinRoute /> },
    ],
  },
]);

/** Mounts the route tree. Everything above it is providers; everything below is screens. */
export function AppRouter(): JSX.Element {
  return <RouterProvider router={router} />;
}
