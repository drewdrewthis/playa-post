import type { JSX } from 'react';

/**
 * `/saved` — the Saved tab's destination, before saved views exist.
 *
 * The tab is in the bar because the comp puts it there and a navigation bar that grows
 * tabs as features land teaches a shape that keeps changing. This screen exists so that
 * tab leads somewhere honest rather than to a blank frame. The real content — saved
 * queries, their live match counts, and the Notify Me toggle — is issue #45's, not this
 * one's.
 */
export function SavedViewsRoute(): JSX.Element {
  return (
    <section className="screen" data-testid="saved-views">
      <h1 className="screen__title">Saved</h1>
      <p className="screen__lede">
        Saved views run over what you can already see — never more.
      </p>

      <p className="screen__empty">Not built yet. Saved views land here soon.</p>

      <p className="screen__aside">
        Any board search will be savable as a view, and Notify Me will ping you when a
        new bulletin matches it.
      </p>
    </section>
  );
}
