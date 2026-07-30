import type { JSX } from 'react';

import './app-shell.css';

/**
 * The application shell: the frame that persists across every route.
 *
 * A placeholder in M1 — it renders enough to prove the PWA builds, mounts, and
 * serves. The router, providers, and feature surfaces land in M2; per addendum §4
 * the `router/` and `providers/` directories are not created until there is
 * something real to put in them.
 */
export function AppShell(): JSX.Element {
  return (
    <main className="app-shell">
      <p className="app-shell__eyebrow">Playa Post</p>
      <h1 className="app-shell__title">Scaffold is live</h1>
      <p className="app-shell__body">
        M1 shipped the workspace, the boundary rules, and CI. The graph, the board, and the
        trust model arrive in M2.
      </p>
      <p className="app-shell__footnote">
        Start at <code>docs/engineering/repo-map.md</code>.
      </p>
    </main>
  );
}
