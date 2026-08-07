import type { JSX } from 'react';
import { Link, useLocation } from 'react-router';

import { activeTabFor } from './active-tab';

/**
 * The bottom tab bar, with the compose button breaking its top edge.
 *
 * Four tabs and a FAB, exactly as `design/Playa Post.dc.html` draws them. Saved and You
 * are rendered even though neither screen is built: a navigation bar that grows tabs as
 * features land teaches a user a shape that keeps changing, and both routes exist and
 * say honestly that they are coming.
 */
export function TabBar(): JSX.Element {
  const { pathname } = useLocation();
  const active = activeTabFor(pathname);

  return (
    <nav className="tab-bar" aria-label="Primary">
      <Tab to="/graph" glyph="◉" label="Graph" active={active === 'graph'} />
      <Tab to="/board" glyph="▤" label="Board" active={active === 'board'} />

      {/*
       * The one way to compose, on every screen. It carries
       * `compose-bulletin-button` because it *is* the compose affordance now — the
       * per-screen buttons the board and the graph used to own are gone, and two
       * routes to one form is one of them going stale.
       */}
      <Link
        className="compose-fab"
        data-testid="compose-bulletin-button"
        to="/board/new"
        aria-label="Post a bulletin"
      >
        <span aria-hidden="true">+</span>
      </Link>

      <Tab to="/saved" glyph="☆" label="Saved" active={active === 'saved'} />
      <Tab to="/you" glyph="◍" label="You" active={active === 'you'} />
    </nav>
  );
}

/**
 * One tab.
 *
 * The glyph is `aria-hidden` and the label is not: "◉" announced literally is noise,
 * and the word beside it already names the destination. `aria-current="page"` carries
 * the selected state to assistive technology, and the stylesheet keys the active colour
 * off the same attribute so the two cannot drift apart.
 */
function Tab({
  to,
  glyph,
  label,
  active,
}: {
  readonly to: string;
  readonly glyph: string;
  readonly label: string;
  readonly active: boolean;
}): JSX.Element {
  return (
    <Link className="tab-bar__link" to={to} aria-current={active ? 'page' : undefined}>
      <span className="tab-bar__glyph" aria-hidden="true">
        {glyph}
      </span>
      <span className="tab-bar__label">{label}</span>
    </Link>
  );
}
