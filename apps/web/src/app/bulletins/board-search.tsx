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
           * ⚠ Disabled, and it stays disabled until there is somewhere for a saved view
           * to go. `views.notifyMe.update` saves exactly one query per user, with no
           * name, no list and no delete; the comp's library of named views is M5. The
           * affordance is drawn because the comp draws it and the gap is worth seeing —
           * but a control that appeared to work and saved nothing would be a lie, so it
           * cannot be pressed and the title says why. The `title` sits on the wrapper
           * because a disabled control shows no tooltip of its own.
           */}
          <span
            className="board-search__save-slot"
            title="Saved views arrive with the Saved tab — nothing can store this query yet."
          >
            <button
              className="board-search__save"
              data-testid="board-search-save-button"
              type="button"
              disabled
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
