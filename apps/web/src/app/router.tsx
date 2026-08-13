import type { JSX } from 'react';
import { createBrowserRouter, Outlet, type RouteObject, RouterProvider } from 'react-router';

import { RequireSession } from './auth/require-session';
import { OfflineProvider } from './offline/offline-provider';
import { BoardRoute } from './routes/board';
import { ComposeBulletinRoute } from './routes/compose-bulletin';
import { GraphHomeRoute } from './routes/graph-home';
import { InviteOpenRoute } from './routes/invite-open';
import { NotFoundRoute } from './routes/not-found';
import { OnboardingRoute } from './routes/onboarding';
import { PersonalLinkOpenRoute } from './routes/personal-link-open';
import { RouteErrorScreen } from './routes/route-error';
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
 * app navigates to from the shell, and a redirect would leave a stray history entry
 * behind every visit to the tab. `active-tab.ts` maps both to the Graph tab.
 *
 * There is no `/people/:userId` route: a person opens as a sheet *over* the graph
 * (`people/person-sheet.tsx`), selection state rather than navigation, which is how
 * the comp draws it.
 *
 * `/saved` and `/you` are routed before either screen is built, because the comp's tab
 * bar has four tabs and a tab that goes nowhere is worse than one that says "soon".
 *
 * The whole tree sits under one pathless root route so every child shares its
 * `errorElement`: before that existed, a throw anywhere below had nowhere to land and
 * surfaced React Router's own developer error screen in production (issue #125) — and
 * it will cover the first loader or action this tree grows, which today it has none of.
 * The `*` catch-all lives on the same root, deliberately
 * outside both `ProtectedLayout` and `OnboardingLayout` — an unknown address has to
 * answer for a signed-out visitor too, not just someone already past `RequireSession`.
 * That root needs no `element`: a route without one renders its `<Outlet />` anyway.
 *
 * Exported as data so `router.unit.test.tsx` can mount *this* tree under a memory
 * router. A test that rebuilt an equivalent shape would stay green after someone
 * deleted the `errorElement` from the shape that actually ships.
 */
export const appRoutes: RouteObject[] = [
  {
    errorElement: <RouteErrorScreen />,
    children: [
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
          {
            /*
             * The personal link (issue #206). Beside `/invite/:token` rather than
             * replacing it: a token already sitting in somebody's chat history has to keep
             * opening, and retiring that route would turn every one of them into the "this
             * invite cannot be opened" screen the issue was filed for.
             *
             * ⚠ Inside `ProtectedLayout`, so a signed-out arrival is bounced through
             * sign-in and returned here (#205) rather than shown a stranger's name.
             */
            path: '/c/:slug',
            element: <PersonalLinkOpenRoute />,
          },
          { path: '/board', element: <BoardRoute /> },
          { path: '/board/new', element: <ComposeBulletinRoute /> },
          { path: '/saved', element: <SavedViewsRoute /> },
          { path: '/you', element: <YourProfileRoute /> },
        ],
      },
      // ⚠ This catch-all and the service worker together mean **every** same-origin
      // navigation reaches the SPA: vite-plugin-pwa's workbox default is
      // `navigateFallback: 'index.html'`, so an unknown path 200s into this screen
      // rather than 404ing. A magic-link or OAuth callback served from this origin, or
      // a `/.well-known/…` path, would therefore render "Nothing pinned here" instead
      // of failing loudly — whichever lands first must be added to
      // `navigateFallbackAllowlist` in `apps/web/vite.config.ts` in the same change.
      { path: '*', element: <NotFoundRoute /> },
    ],
  },
];

const router = createBrowserRouter(appRoutes);

/** Mounts the route tree. Everything above it is providers; everything below is screens. */
export function AppRouter(): JSX.Element {
  return <RouterProvider router={router} />;
}
