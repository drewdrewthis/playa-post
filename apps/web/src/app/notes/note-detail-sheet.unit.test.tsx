// @vitest-environment jsdom
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';

import type { Graph, Note } from '@playa-post/contracts';

import { GRAPH_LIST_QUERY_KEY } from '../graph/graph-query-keys';
import {
  createFakeApi,
  mountWithApi,
  requireElement,
  type FakeApi,
  type FakeApiRoutes,
  type MountedTree,
} from '../testing/mount-with-api';

import { NoteDetailSheet } from './note-detail-sheet';

/**
 * The note detail sheet, mounted (#176, decision D14).
 *
 * ⚠ jsdom, by the per-file pragma above: the `unit` project runs in `node`, and only the
 * files that render React ask for a DOM.
 *
 * The API is a **fake** — an in-memory `PlayaPostClient` — so every assertion is about what
 * the sheet *sent* and what it did with the answer, never about a call sequence. The
 * decision the sheet renders is `note-pin-back.ts`'s and is exhaustively covered there;
 * what this file adds is the wiring, and the two §6a absences that only a mount can prove.
 */

const AUTHOR_ID = 'lena-id';
const VIEWER_ID = 'viewer-id';

/** What the graph would say if the sheet asked — and what it must not read a name out of. */
const GRAPH: Graph = {
  people: [
    { userId: VIEWER_ID, degree: 0, disclosure: 'full', trust: null },
    { userId: AUTHOR_ID, degree: 1, disclosure: 'full', displayName: 'Lena', trust: null },
  ],
  edges: [],
};

const CARD_NOTE: Note = {
  id: 'note-1',
  body: 'The card’s copy of the note.',
  createdAt: '2026-08-11T09:00:00.000Z',
  author: { userId: AUTHOR_ID, disclosure: 'full', displayName: 'Lena' },
};

const SERVER_NOTE: Note = {
  ...CARD_NOTE,
  body: 'The server’s copy of the note.',
};

/** A refusal shaped like the tRPC envelope `applicationErrorCode` reads. */
function serverRefusal(applicationCode: string): Error {
  return Object.assign(new Error('refused'), {
    data: { code: 'NOT_FOUND', applicationCode },
  });
}

let tree: MountedTree | null = null;
let api: FakeApi | null = null;
let closes = 0;

afterEach(async () => {
  const mounted = tree;

  tree = null;
  api = null;
  closes = 0;

  if (mounted !== null) {
    await mounted.unmount();
  }
});

async function openSheet(
  note: Note = CARD_NOTE,
  overrides: FakeApiRoutes = {},
  seedGraph = false,
): Promise<void> {
  api = createFakeApi({
    'notes.getById': () => SERVER_NOTE,
    'graph.list': () => GRAPH,
    ...overrides,
  });

  tree = await mountWithApi(
    // A router, because the pin-back control is a `Link`.
    <MemoryRouter>
      <NoteDetailSheet
        note={note}
        now={new Date('2026-08-11T09:05:00.000Z')}
        onClose={() => {
          closes += 1;
        }}
      />
    </MemoryRouter>,
    api,
    // Planted so the absence assertions below are load-bearing: a name the sheet could
    // genuinely have reached, and did not.
    seedGraph ? { seedQueries: [{ queryKey: GRAPH_LIST_QUERY_KEY, data: GRAPH }] } : undefined,
  );
}

function container(): HTMLElement {
  if (tree === null) {
    throw new Error('the sheet is not mounted');
  }

  return tree.container;
}

/**
 * What a screen reader would announce the dialog as — resolved the way one resolves it,
 * by following `aria-labelledby` rather than by reading whatever element the test expected
 * to find there. An attribute selector because React's `useId` produces `:r0:`-shaped ids,
 * which are not valid in a `#id` selector without escaping.
 */
function dialogName(): string {
  const sheet = requireElement(container(), '[data-testid="note-detail-sheet"]');
  const labelledBy = sheet.getAttribute('aria-labelledby');

  if (labelledBy === null) {
    throw new Error('the sheet names itself with nothing');
  }

  return requireElement(container(), `[id="${labelledBy}"]`).textContent ?? '';
}

function calls(): FakeApi['calls'] {
  if (api === null) {
    throw new Error('the sheet is not mounted');
  }

  return api.calls;
}

describe('the read behind the expanded view (#176)', () => {
  it('asks notes.getById for the note that was opened, and nothing else', async () => {
    await openSheet();

    const detail = calls().filter((call) => call.path === 'notes.getById');

    expect(detail).toHaveLength(1);
    // ⚠ The id and no viewer identifier. `notes.getById` takes the note's id as its whole
    // input; a field naming the reader would be the ADR-0002 §5a violation
    // `viewer-id-provenance` walks the router for.
    expect(detail[0]?.input).toEqual({ noteId: 'note-1' });
  });

  it('renders the server’s copy once it lands, not the card’s', async () => {
    await openSheet();

    expect(requireElement(container(), '[data-testid="note-detail-sheet"]').textContent).toContain(
      'The server’s copy of the note.',
    );
  });

  /*
   * The fallback is the same note from the read this board was built out of, so a note
   * still opens with the radio off. A transport failure says nothing about the note —
   * announcing anything would turn a tunnel into a deletion.
   */
  it('falls back to the card’s copy when the read fails, and claims nothing about it', async () => {
    await openSheet(CARD_NOTE, {
      'notes.getById': () => {
        throw new Error('offline');
      },
    });

    const sheet = requireElement(container(), '[data-testid="note-detail-sheet"]');

    expect(sheet.textContent).toContain('The card’s copy of the note.');
    expect(container().querySelector('[data-testid="note-detail-gone"]')).toBeNull();
  });

  it('says the copy is stale when the server answers NOTE_GONE', async () => {
    await openSheet(CARD_NOTE, {
      'notes.getById': () => {
        throw serverRefusal('NOTE_GONE');
      },
    });

    expect(requireElement(container(), '[data-testid="note-detail-gone"]').textContent).toContain(
      'not on your board',
    );
    // The note the reader already had is still on screen under it: gone means the server
    // will not serve it now, never that they may not finish reading what they were given.
    expect(requireElement(container(), '[data-testid="note-detail-sheet"]').textContent).toContain(
      'The card’s copy of the note.',
    );
  });

  /*
   * ⚠ Load-bearing because the graph *does* answer here: Lena is degree 1 in `GRAPH`, so
   * every other input to the offer says yes and only the refusal says no. Offering to write
   * back one line under "this note is not on your board" is the screen contradicting itself
   * within a single sheet.
   */
  it('offers no way to answer a note the server just refused', async () => {
    await openSheet(CARD_NOTE, {
      'notes.getById': () => {
        throw serverRefusal('NOTE_GONE');
      },
    });

    expect(container().querySelector('[data-testid="note-detail-gone"]')).not.toBeNull();
    expect(container().querySelector('[data-testid="note-detail-pin-back-link"]')).toBeNull();
    expect(container().querySelector('[data-testid="note-detail-pin-back-hint"]')).toBeNull();
  });
});

/*
 * A dialog is announced by its accessible name before its contents are read, so the name
 * has to distinguish this note from the last one. It used to point at the type pill, whose
 * text is the literal word "Note" for every note there has ever been.
 */
describe('how the expanded view announces itself', () => {
  it('names the dialog after the note, not after the word “Note”', async () => {
    await openSheet();

    expect(dialogName()).toBe('Note from Lena — The server’s copy of the note.');
  });

  /*
   * §6a again, on the one surface where a name is heard rather than seen. `GRAPH` discloses
   * "Lena" and the note does not, so a label built from the wrong payload would say so out
   * loud — the same leak `note-pin-back.ts` closes for the button.
   */
  it('names nobody in the announcement when the note withheld the name', async () => {
    const withheld: Note = {
      ...CARD_NOTE,
      author: { userId: AUTHOR_ID, disclosure: 'topology_only' },
    };

    await openSheet(withheld, { 'notes.getById': () => withheld });

    expect(dialogName()).toBe('Note — The card’s copy of the note.');
    expect(dialogName()).not.toContain('Lena');
  });
});

describe('pinning back (#176, decision D14)', () => {
  it('offers the control, addressed to the author, routing into the compose screen', async () => {
    await openSheet();

    const link = requireElement<HTMLAnchorElement>(
      container(),
      '[data-testid="note-detail-pin-back-link"]',
    );

    expect(link.getAttribute('href')).toBe(`/board/new?noteTo=${AUTHOR_ID}`);
    expect(link.textContent).toBe('Pin a note to Lena’s board');
  });

  /*
   * ⚠ The load-bearing absence, and the reason the graph is seeded here. The note carries
   * no author at all, so there is nobody to address — but the viewer's own graph *does*
   * hold a person with the author's id and name, which is exactly the material a
   * "helpful" fallback would be built from. Neither may reach the DOM (§6a, B5's
   * person-projection sub-case).
   */
  it('offers nothing, and names nobody, when the note has no author card', async () => {
    const authorless: Note = {
      id: 'note-2',
      body: 'The spare goggles are yours.',
      createdAt: '2026-08-11T09:00:00.000Z',
    };

    await openSheet(authorless, { 'notes.getById': () => authorless }, true);

    const sheet = requireElement(container(), '[data-testid="note-detail-sheet"]');

    expect(sheet.textContent).toContain('The spare goggles are yours.');
    expect(container().querySelector('[data-testid="note-detail-pin-back-link"]')).toBeNull();
    expect(container().querySelector('[data-testid="note-detail-pin-back-hint"]')).toBeNull();
    expect(sheet.textContent).not.toContain('Lena');
    expect(sheet.innerHTML).not.toContain(AUTHOR_ID);
  });

  it('states the distance instead of offering a control when the author is no longer close', async () => {
    const distantGraph: Graph = {
      people: [
        { userId: VIEWER_ID, degree: 0, disclosure: 'full', trust: null },
        { userId: AUTHOR_ID, degree: 2, disclosure: 'full', displayName: 'Lena', trust: null },
      ],
      edges: [],
    };

    await openSheet(CARD_NOTE, { 'graph.list': () => distantGraph });

    expect(
      requireElement(container(), '[data-testid="note-detail-pin-back-hint"]').textContent,
    ).toBe('Pinning a note needs a direct connection — Lena is 2nd degree.');
    expect(container().querySelector('[data-testid="note-detail-pin-back-link"]')).toBeNull();
  });

  /*
   * The four-states discipline: a graph read that failed is not a graph read that came
   * back saying "not connected". Silence is the honest answer, and it never offers a
   * button the server would refuse.
   */
  it('offers neither a control nor a hint while the graph is unreadable', async () => {
    await openSheet(CARD_NOTE, {
      'graph.list': () => {
        throw new Error('offline');
      },
    });

    expect(container().querySelector('[data-testid="note-detail-pin-back-link"]')).toBeNull();
    expect(container().querySelector('[data-testid="note-detail-pin-back-hint"]')).toBeNull();
  });
});

describe('§6a on the author line', () => {
  /*
   * The *partial* absence: a person who is still in the viewer's world and discloses
   * nothing. The card is present, so the line stays — as `PersonIdentity`'s private
   * treatment, never as a name derived from anywhere.
   */
  it('renders the private treatment for an author whose name is withheld', async () => {
    const withheld: Note = {
      ...CARD_NOTE,
      author: { userId: AUTHOR_ID, disclosure: 'topology_only' },
    };

    await openSheet(withheld, { 'notes.getById': () => withheld }, true);

    const sheet = requireElement(container(), '[data-testid="note-detail-sheet"]');

    expect(sheet.textContent).toContain('Private connection');
    expect(sheet.textContent).not.toContain('Lena');

    /*
     * ⚠ The positive half, and it is not decoration: the graph this sheet is holding says
     * this person is Lena at degree 1, so withholding the name must not also withhold the
     * control. Without this assertion the test would go green if pin-back disappeared
     * altogether — which is the other way to stop leaking a name, and the wrong one.
     */
    expect(
      requireElement(container(), '[data-testid="note-detail-pin-back-link"]').textContent,
    ).toBe('Pin a note to their board');
  });
});

describe('the ways out', () => {
  it('closes on the CLOSE control', async () => {
    await openSheet();

    const close = requireElement<HTMLButtonElement>(
      container(),
      '[data-testid="note-detail-close-button"]',
    );

    await tree?.run(() => {
      close.click();
    });

    expect(closes).toBe(1);
  });

  it('closes on Escape', async () => {
    await openSheet();

    await tree?.run(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    expect(closes).toBe(1);
  });

  it('closes on a tap on the scrim', async () => {
    await openSheet();

    const scrim = requireElement<HTMLDivElement>(
      container(),
      '.note-detail-sheet__scrim',
    );

    await tree?.run(() => {
      scrim.click();
    });

    expect(closes).toBe(1);
  });
});
