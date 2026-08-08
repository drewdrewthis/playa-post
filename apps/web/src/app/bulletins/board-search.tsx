import { useId, useState, type JSX } from 'react';

import {
  BOARD_FILTER_CHIPS,
  isBoardQueryActive,
  matchCountLabel,
  type BoardTypeFilter,
} from './board-query';

import './board-search.css';

/**
 * The comp's grammar help, narrowed to what the server actually parses.
 *
 * The comp advertises `from:`, `deg:`, `trust:`, `is:`, negation and quoted phrases.
 * **Every one of those is refused server-side** — `parseBoardQuery` names the offending
 * token and rejects the call rather than ignoring it (ADR-0007:53-56) — so printing
 * them here would be an instruction to write a query this product answers with an
 * error. They arrive in M5, and this line grows when they do.
 */
const HELP_TEXT = 'type:request · bare words match a title or body · every term must match';

/**
 * The board's search field, help toggle, match count, and filter chips (issue #45).
 *
 * Stateless about *what matches*: it reports what the person typed and which chip they
 * chose, and the board route turns that into one `bulletins.board({ query })` call. No
 * filtering happens on this side of the wire, so a search can never widen past what the
 * viewer is authorized to see.
 */
export function BoardSearch({
  search,
  onSearchChange,
  filter,
  onFilterChange,
  matchCount,
  onSave,
  saving,
  settledQueryActive,
}: {
  readonly search: string;
  readonly onSearchChange: (search: string) => void;
  readonly filter: BoardTypeFilter;
  readonly onFilterChange: (filter: BoardTypeFilter) => void;
  /**
   * How many bulletins the server answered with, or `null` while that is unknown —
   * still loading, or refused. `null` renders no count rather than a number nobody
   * has been told yet.
   */
  readonly matchCount: number | null;
  /**
   * Keep the current query as a saved view (issue #45).
   *
   * The board route owns what a saved view *is* — it composes the query and names it —
   * because this component is stateless about what matches and must stay that way.
   */
  readonly onSave: () => void;
  /** Whether a save is in flight, so the control cannot be tapped twice into two views. */
  readonly saving: boolean;
  /**
   * Whether a query that could actually be saved exists *yet*.
   *
   * ⚠ **Not the same question as this component's own `queryActive`**, which is computed
   * from the raw field and decides whether the control is *shown*. The board composes
   * what gets saved from a debounced copy of that field, so for a beat after the first
   * keystroke a query is being typed but none has settled. `onSave` returns early in
   * that window, so without this the button would be visible, enabled, and inert.
   */
  readonly settledQueryActive: boolean;
}): JSX.Element {
  const [helpOpen, setHelpOpen] = useState(false);
  const helpId = useId();
  const queryActive = isBoardQueryActive(filter, search);

  return (
    // A form, so the field is a real search box to assistive technology and to a
    // browser's own autofill. There is nothing to submit: results follow the typing,
    // and Enter must not reload the page.
    <form
      className="board-search"
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
      }}
    >
      <div className="board-search__field">
        <span className="board-search__glyph" aria-hidden="true">
          ⌕
        </span>

        <input
          className="board-search__input"
          data-testid="board-search-input"
          type="search"
          value={search}
          aria-label="Search the board"
          aria-describedby={helpOpen ? helpId : undefined}
          placeholder="type:request welding …"
          onChange={(event) => {
            onSearchChange(event.target.value);
          }}
        />

        {search === '' ? null : (
          <button
            className="board-search__icon-action"
            data-testid="board-search-clear-button"
            type="button"
            aria-label="Clear the search"
            onClick={() => {
              onSearchChange('');
            }}
          >
            <span aria-hidden="true">✕</span>
          </button>
        )}

        <button
          className="board-search__icon-action board-search__icon-action--help"
          data-testid="board-search-help-button"
          type="button"
          aria-label="What can I search for?"
          aria-expanded={helpOpen}
          aria-controls={helpId}
          onClick={() => {
            setHelpOpen((open) => !open);
          }}
        >
          <span aria-hidden="true">?</span>
        </button>
      </div>

      {helpOpen ? (
        <p className="board-search__help" id={helpId}>
          {HELP_TEXT}
        </p>
      ) : null}

      {queryActive ? (
        <div className="board-search__status">
          <span
            className="board-search__count"
            data-testid="board-search-match-count"
            aria-live="polite"
          >
            {matchCount === null ? null : matchCountLabel(matchCount)}
          </span>

          {/*
           * Live since `views.saved.save` shipped (issue #45). It was drawn and disabled
           * for one milestone because the comp drew it and `views.notifyMe.update` — one
           * unnamed query per user — was not somewhere a saved view could go; a control
           * that appeared to work and saved nothing would have been a lie.
           *
           * Disabled while a save is in flight, so a double tap cannot make two views
           * out of one intent — and until the query it would save has actually settled.
           * The slot appears on the first keystroke but the board debounces what it
           * composes, so without `settledQueryActive` there is a window where this reads
           * as ready and does nothing at all when pressed.
           */}
          <span className="board-search__save-slot">
            <button
              className="board-search__save"
              data-testid="board-search-save-button"
              type="button"
              disabled={saving || !settledQueryActive}
              onClick={onSave}
            >
              ☆ Save as view
            </button>
          </span>
        </div>
      ) : null}

      <div className="board-search__chips" role="group" aria-label="Filter by type">
        {BOARD_FILTER_CHIPS.map((chip) => (
          <button
            key={chip.filter}
            className="board-search__chip"
            data-testid={`board-filter-chip-${chip.filter}`}
            type="button"
            aria-pressed={chip.filter === filter}
            onClick={() => {
              onFilterChange(chip.filter);
            }}
          >
            {chip.label}
          </button>
        ))}
      </div>
    </form>
  );
}
