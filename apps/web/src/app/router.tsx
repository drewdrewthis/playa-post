import type { JSX } from 'react';
import { createBrowserRouter, Outlet, RouterProvider } from 'react-router';

import { RequireSession } from './auth/require-session';
import { OfflineProvider } from './offline/offline-provider';
import { BoardRoute } from './routes/board';
import { ComposeBulletinRoute } from './routes/compose-bulletin';
import { GraphHomeRoute } from './routes/graph-home';
import { InviteOpenRoute } from './routes/invite-open';
import { OnboardingRoute } from './routes/onboarding';
import { PersonSheetRoute } from './routes/person-sheet';
import { SavedViewsRoute } from './routes/saved-views';
import { SignInRoute } from './routes/sign-in';
import { WelcomeRoute } from './routes/welcome';
import { YourProfileRoute } from './routes/your-profile';
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
 * Onboarding: authenticated, but **outside the shell**.
 *
 * The comp draws onboarding as a full-screen takeover over the chrome, and it is right
 * to. A tab bar on this screen offers a graph and a board to someone who has no
 * `app.users` row yet, and the shell's own notifications query would spend the whole
 * screen being refused. There is no `OfflineProvider` either — this screen queues
 * nothing.
 */
function OnboardingLayout(): JSX.Element {
  return (
    <RequireSession>
      <Outlet />
    </RequireSession>
  );
}

/**
 * `/graph` is a second path to graph home rather than a redirect: it is the URL the
 * app navigates to from the shell, and a redirect would put an extra history entry
 * between a person sheet and the graph a user came from. `active-tab.ts` maps both to
 * the Graph tab.
 *
 * `/saved` and `/you` are routed before either screen is built, because the comp's tab
 * bar has four tabs and a tab that goes nowhere is worse than one that says "soon".
 */
const router = createBrowserRouter([
  { path: '/signin', element: <SignInRoute /> },
  { path: '/welcome', element: <WelcomeRoute /> },
  {
    element: <OnboardingLayout />,
    children: [{ path: '/onboarding', element: <OnboardingRoute /> }],
  },
  {
    element: <ProtectedLayout />,
    children: [
      { path: '/', element: <GraphHomeRoute /> },
      { path: '/graph', element: <GraphHomeRoute /> },
      { path: '/invite/:token', element: <InviteOpenRoute /> },
      { path: '/people/:userId', element: <PersonSheetRoute /> },
      { path: '/board', element: <BoardRoute /> },
      { path: '/board/new', element: <ComposeBulletinRoute /> },
      { path: '/saved', element: <SavedViewsRoute /> },
      { path: '/you', element: <YourProfileRoute /> },
    ],
  },
]);

/** Mounts the route tree. Everything above it is providers; everything below is screens. */
export function AppRouter(): JSX.Element {
  return <RouterProvider router={router} />;
}
