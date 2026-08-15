import type { JSX } from 'react';
import { Link, useLocation } from 'react-router';

import { activeTabFor } from './active-tab';

/**
 * The bottom tab bar, with the add button breaking its top edge.
 *
 * Four tabs and a FAB. The comp drew Saved in the fourth slot, which went with the
 * Saved Views feature (issue #208); Info (issue #216) now stands there — the pitch,
 * the repository, and the support link, permanently reachable.
 */
export function TabBar({ onAdd }: { readonly onAdd: () => void }): JSX.Element {
  const { pathname } = useLocation();
  const active = activeTabFor(pathname);

  return (
    <nav className="tab-bar" aria-label="Primary">
      <Tab to="/graph" glyph="◉" label="Graph" active={active === 'graph'} />
      <Tab to="/board" glyph="▤" label="Board" active={active === 'board'} />

      {/*
       * The one "add" on every screen — a button now, not a link (issue #221): "add"
       * means two things in this product, so the FAB opens the chooser and the
       * chooser's board option is what carries `compose-bulletin-button`. The
       * per-screen compose buttons stayed gone; two routes to one form is one of
       * them going stale.
       */}
      <button
        className="compose-fab"
        data-testid="add-button"
        type="button"
        aria-label="Add"
        onClick={onAdd}
      >
        <span aria-hidden="true">+</span>
      </button>

      <Tab to="/info" glyph="✺" label="Info" active={active === 'info'} />
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
