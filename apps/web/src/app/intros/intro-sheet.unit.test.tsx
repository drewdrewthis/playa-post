// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { IntroPerson } from '@playa-post/contracts';

import { GRAPH_LIST_QUERY_KEY } from '../graph/graph-query-keys';
import {
  allElements,
  createFakeApi,
  mountWithApi,
  requireElement,
  setFieldValue,
  type FakeApi,
  type FakeApiRoutes,
  type MountedTree,
  type SeededQuery,
} from '../testing/mount-with-api';

import { INTRO_NO_CANDIDATES_LINE } from './intro-copy';
import { IntroSheet } from './intro-sheet';

/**
 * The intro sheet, mounted (issue #89).
 *
 * ⚠ jsdom, by the per-file pragma above: the `unit` project runs in `node`, and only the
 * files that render React ask for a DOM.
 *
 * The API is a **fake** — an in-memory `PlayaPostClient` — so every assertion is about
 * what the sheet *sent* and what it did with the answer, never about a call sequence.
 */

const TARGET_ID = 'kiki-id';

const LENA: IntroPerson = { userId: 'lena-id', disclosure: 'full', displayName: 'Lena' };
const OMAR: IntroPerson = { userId: 'omar-id', disclosure: 'full', displayName: 'Omar' };

/*
 * A via whose identity this viewer may not be shown. The fields below the payload are
 * what the person *actually* is — the test asserts none of them reaches the DOM, which is
 * the only way to catch a placeholder derived from an id.
 */
const WITHHELD_VIA: IntroPerson = { userId: 'via-9f3c2a', disclosure: 'topology_only' };
const WITHHELD_TRUTH = { handle: 'nightowl', displayName: 'Rae' };

let tree: MountedTree | null = null;
let opener: HTMLButtonElement | null = null;

afterEach(async () => {
  const mounted = tree;

  tree = null;

  if (mounted !== null) {
    await mounted.unmount();
  }

  opener?.remove();
  opener = null;
});

function receipt(viaUserId: string): unknown {
  return {
    id: 'request-1',
    viaUserId,
    targetUserId: TARGET_ID,
    status: 'requested',
    createdAt: '2026-08-10T09:00:00.000Z',
  };
}

/** A refusal shaped like the tRPC envelope `applicationErrorCode` reads. */
function serverRefusal(applicationCode: string): Error {
  return Object.assign(new Error('refused'), {
    data: { code: 'NOT_FOUND', applicationCode },
  });
}

async function openSheet(
  vias: readonly IntroPerson[],
  extraRoutes: FakeApiRoutes = {},
  onClose: () => void = () => {},
  seedQueries?: readonly SeededQuery[],
): Promise<FakeApi> {
  const api = createFakeApi({
    'intros.viaCandidates': () => vias,
    ...extraRoutes,
  });

  tree = await mountWithApi(
    <IntroSheet targetUserId={TARGET_ID} targetName="Kiki" onClose={onClose} />,
    api,
    seedQueries === undefined ? undefined : { seedQueries },
  );

  return api;
}

/** The mounted tree, or a failure that says so rather than a null-dereference. */
function mounted(): MountedTree {
  if (tree === null) {
    throw new Error('the sheet is not mounted');
  }

  return tree;
}

describe('the intro sheet', () => {
  describe('as a dialog', () => {
    it('is a dialog labelled by its own title, and never claims modality', async () => {
      await openSheet([LENA]);

      const sheet = requireElement(mounted().container, '[data-testid="intro-sheet"]');

      expect(sheet.getAttribute('role')).toBe('dialog');
      /* ⚠ Nothing behind the scrim is `inert`, so claiming modality would describe a trap
         this sheet does not build — the rule every other sheet in this app keeps. */
      expect(sheet.hasAttribute('aria-modal')).toBe(false);

      const labelledBy = sheet.getAttribute('aria-labelledby') ?? '';

      expect(labelledBy).not.toBe('');
      expect(document.getElementById(labelledBy)?.textContent).toBe('Intro to Kiki');
    });

    it('takes focus on open and hands it back to the opener on close', async () => {
      opener = document.createElement('button');
      document.body.append(opener);
      opener.focus();

      await openSheet([LENA]);

      const sheet = requireElement(mounted().container, '[data-testid="intro-sheet"]');

      expect(document.activeElement).toBe(sheet);

      const mountedTree = mounted();

      tree = null;
      await mountedTree.unmount();

      expect(document.activeElement).toBe(opener);
    });

    it('closes on CLOSE, on Escape, and on the scrim', async () => {
      const onClose = vi.fn();

      await openSheet([LENA], {}, onClose);

      await mounted().run(() => {
        requireElement(mounted().container, '[data-testid="intro-sheet-close-button"]').click();
      });
      expect(onClose).toHaveBeenCalledTimes(1);

      await mounted().run(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      });
      expect(onClose).toHaveBeenCalledTimes(2);

      await mounted().run(() => {
        requireElement(mounted().container, '.intro-sheet__scrim').click();
      });
      expect(onClose).toHaveBeenCalledTimes(3);
    });
  });

  describe('before anything is sent', () => {
    /*
     * ⚠ Sending is consent to be seen: a passed-on request shows the target the
     * requester's identity and note even when the requester's own visibility setting
     * would hide them. The server does that deliberately, so this sentence has to be on
     * screen before the button is pressable.
     */
    it('says what sending means, above the note field', async () => {
      await openSheet([LENA]);

      const consent = requireElement(
        mounted().container,
        '[data-testid="intro-sheet-consent"]',
      ).textContent;

      expect(consent).toContain('see who you are');
      expect(consent).toContain('read your note');
      expect(consent).toContain('visibility setting');
    });
  });

  describe('when nobody can make the introduction', () => {
    /*
     * ⚠ An empty list is the server's answer to every refusal at once, and it must never
     * render as an empty chip row above a live button — a press there is a refusal the
     * reader was invited to earn.
     */
    it('says so and disables the send, even with a note typed', async () => {
      await openSheet([]);

      const container = mounted().container;

      expect(
        requireElement(container, '[data-testid="intro-sheet-no-candidates"]').textContent,
      ).toBe(INTRO_NO_CANDIDATES_LINE);
      expect(allElements(container, '[data-testid="intro-sheet-via-chip"]')).toHaveLength(0);

      const send = requireElement<HTMLButtonElement>(
        container,
        '[data-testid="intro-sheet-send-button"]',
      );

      expect(send.disabled).toBe(true);

      await mounted().run(() => {
        setFieldValue(
          requireElement<HTMLTextAreaElement>(container, '[data-testid="intro-sheet-note-input"]'),
          'We both ride at dawn.',
        );
      });

      expect(send.disabled).toBe(true);
    });
  });

  describe('when a candidate discloses nothing', () => {
    /*
     * ⚠ Not initials, not a truncated id, not "Unknown". Every one of those re-identifies
     * the person the projection just hid — and on an intro surface the reader is unusually
     * likely to believe they already know who it is.
     */
    it('renders the chip with no name, and puts none of their identifiers in the DOM', async () => {
      /*
       * ⚠ The shared query cache is seeded with the person's *true* identity under the
       * graph-list key, exactly as it would be after a `/graph` visit. Without this the
       * absence assertions below are a tautology — nothing in the tree ever held the
       * name — and a future "resolve the label from the graph cache" change would pass.
       */
      await openSheet([WITHHELD_VIA], {}, () => {}, [
        {
          queryKey: GRAPH_LIST_QUERY_KEY,
          data: {
            people: [
              {
                userId: WITHHELD_VIA.userId,
                degree: 2,
                disclosure: 'full',
                displayName: WITHHELD_TRUTH.displayName,
                handle: WITHHELD_TRUTH.handle,
                trust: null,
              },
            ],
            edges: [],
          },
        },
      ]);

      const container = mounted().container;
      const chip = requireElement(container, '[data-testid="intro-sheet-via-chip"]');

      expect(chip.textContent).toBe('Private connection');

      const markup = container.innerHTML;

      expect(markup).not.toContain(WITHHELD_VIA.userId);
      expect(markup).not.toContain(WITHHELD_TRUTH.handle);
      expect(markup).not.toContain(WITHHELD_TRUTH.displayName);

      // The submit degrades with it: a name it does not have cannot appear in the label.
      expect(
        requireElement(container, '[data-testid="intro-sheet-send-button"]').textContent,
      ).toBe('Ask them to introduce you');
    });
  });

  describe('sending', () => {
    it('preselects a lone candidate and sends the trimmed note to the server', async () => {
      const api = await openSheet([LENA], {
        'intros.request': () => receipt(LENA.userId),
      });

      const container = mounted().container;

      expect(
        requireElement(container, '[data-testid="intro-sheet-via-chip"]').getAttribute(
          'aria-pressed',
        ),
      ).toBe('true');

      await mounted().run(() => {
        setFieldValue(
          requireElement<HTMLTextAreaElement>(container, '[data-testid="intro-sheet-note-input"]'),
          '  We both ride at dawn.  ',
        );
      });

      const send = requireElement<HTMLButtonElement>(
        container,
        '[data-testid="intro-sheet-send-button"]',
      );

      expect(send.disabled).toBe(false);
      expect(send.textContent).toBe('Ask Lena to introduce you');

      await mounted().run(() => {
        send.click();
      });

      expect(api.calls.filter((call) => call.kind === 'mutate')).toEqual([
        {
          kind: 'mutate',
          path: 'intros.request',
          input: {
            targetUserId: TARGET_ID,
            viaUserId: LENA.userId,
            note: 'We both ride at dawn.',
          },
        },
      ]);

      // The form gives way to the answer: somebody else has to decide now, and the sheet
      // says so rather than vanishing.
      expect(
        requireElement(container, '[data-testid="intro-sheet-sent"]').textContent,
      ).toContain('Lena');
      expect(container.querySelector('[data-testid="intro-sheet-send-button"]')).toBeNull();
    });

    it('sends the via the reader chose when there is more than one', async () => {
      const api = await openSheet([LENA, OMAR], {
        'intros.request': () => receipt(OMAR.userId),
      });

      const container = mounted().container;
      const chips = allElements<HTMLButtonElement>(
        container,
        '[data-testid="intro-sheet-via-chip"]',
      );

      expect(chips).toHaveLength(2);
      // Nothing is preselected out of two: choosing who to ask is the one decision this
      // sheet exists to collect.
      expect(chips.every((chip) => chip.getAttribute('aria-pressed') === 'false')).toBe(true);
      expect(
        requireElement<HTMLButtonElement>(container, '[data-testid="intro-sheet-send-button"]')
          .disabled,
      ).toBe(true);

      await mounted().run(() => {
        chips[1]?.click();
      });

      await mounted().run(() => {
        setFieldValue(
          requireElement<HTMLTextAreaElement>(container, '[data-testid="intro-sheet-note-input"]'),
          'We keep missing each other.',
        );
      });

      await mounted().run(() => {
        requireElement(container, '[data-testid="intro-sheet-send-button"]').click();
      });

      expect(api.calls.filter((call) => call.kind === 'mutate')).toEqual([
        {
          kind: 'mutate',
          path: 'intros.request',
          input: {
            targetUserId: TARGET_ID,
            viaUserId: OMAR.userId,
            note: 'We keep missing each other.',
          },
        },
      ]);
    });

    /*
     * ⚠ One sentence for every refusal. The server answers `INTRO_UNAVAILABLE` identically
     * for a target at the wrong distance, a via who does not know them, a person who is
     * not there, and an ask already open — so the sheet says the flat thing and explains
     * nothing.
     */
    it('renders a refusal without explaining it, and leaves the reader able to try again', async () => {
      await openSheet([LENA], {
        'intros.request': () => {
          throw serverRefusal('INTRO_UNAVAILABLE');
        },
      });

      const container = mounted().container;

      await mounted().run(() => {
        setFieldValue(
          requireElement<HTMLTextAreaElement>(container, '[data-testid="intro-sheet-note-input"]'),
          'We both ride at dawn.',
        );
      });

      await mounted().run(() => {
        requireElement(container, '[data-testid="intro-sheet-send-button"]').click();
      });

      const error = requireElement(container, '[data-testid="intro-sheet-error"]');

      expect(error.textContent).toBe('That introduction is not available.');
      expect(error.getAttribute('role')).toBe('alert');
      expect(container.querySelector('[data-testid="intro-sheet-sent"]')).toBeNull();
      expect(
        requireElement<HTMLButtonElement>(container, '[data-testid="intro-sheet-send-button"]')
          .disabled,
      ).toBe(false);
    });
  });
});
