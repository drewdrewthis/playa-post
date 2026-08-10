// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import type { IntroInboxRow, IntroPerson } from '@playa-post/contracts';

import {
  allElements,
  createFakeApi,
  mountWithApi,
  requireElement,
  type FakeApi,
  type MountedTree,
} from '../testing/mount-with-api';

import { IntroInbox } from './intro-inbox';

/**
 * The via's inbox at the top of `/graph` (issue #89).
 *
 * ⚠ jsdom, by the per-file pragma above: the `unit` project runs in `node`.
 */

const LENA: IntroPerson = { userId: 'lena-id', disclosure: 'full', displayName: 'Lena' };
const KIKI: IntroPerson = { userId: 'kiki-id', disclosure: 'full', displayName: 'Kiki' };
const WITHHELD_REQUESTER: IntroPerson = { userId: 'ghost-4b21', disclosure: 'topology_only' };

const VIA_ROW: IntroInboxRow = {
  id: 'request-1',
  role: 'via',
  note: 'We both ride at dawn.',
  createdAt: '2026-08-10T09:00:00.000Z',
  requester: LENA,
  target: KIKI,
};

const TARGET_ROW: IntroInboxRow = {
  id: 'request-2',
  role: 'target',
  note: 'I heard you fix bikes.',
  createdAt: '2026-08-10T10:00:00.000Z',
  requester: LENA,
};

let tree: MountedTree | null = null;

afterEach(async () => {
  const mountedTree = tree;

  tree = null;

  if (mountedTree !== null) {
    await mountedTree.unmount();
  }
});

async function mountInbox(
  rows: readonly IntroInboxRow[],
  decide: (input: unknown) => unknown = () => ({}),
): Promise<FakeApi> {
  const api = createFakeApi({
    'intros.listInbox': () => rows,
    'intros.decide': decide,
  });

  tree = await mountWithApi(<IntroInbox />, api);

  return api;
}

function mounted(): MountedTree {
  if (tree === null) {
    throw new Error('the inbox is not mounted');
  }

  return tree;
}

describe('the intro inbox', () => {
  /*
   * The graph screen's subject is the network. An empty state here would put "no intros"
   * in front of everybody who has none, forever, on a screen that had nothing to say.
   */
  it('renders nothing at all when nothing is waiting', async () => {
    await mountInbox([]);

    expect(mounted().container.querySelector('[data-testid="intro-inbox"]')).toBeNull();
  });

  describe('a row this viewer was asked to act on', () => {
    it('names both other people, shows the note whole, and offers both decisions', async () => {
      await mountInbox([VIA_ROW]);

      const row = requireElement(mounted().container, '[data-testid="intro-inbox-via-row"]');

      expect(row.textContent).toContain('Lena');
      expect(row.textContent).toContain('Kiki');
      expect(row.textContent).toContain('We both ride at dawn.');
      expect(row.querySelector('[data-testid="intro-pass-on-button"]')).not.toBeNull();
      expect(row.querySelector('[data-testid="intro-decline-button"]')).not.toBeNull();
    });

    it('passes it on as the via, naming the request and the decision', async () => {
      const api = await mountInbox([VIA_ROW]);

      await mounted().run(() => {
        requireElement(mounted().container, '[data-testid="intro-pass-on-button"]').click();
      });

      expect(api.calls.filter((call) => call.kind === 'mutate')).toEqual([
        {
          kind: 'mutate',
          path: 'intros.decide',
          input: { introRequestId: 'request-1', decision: 'pass_on' },
        },
      ]);
    });

    /*
     * ⚠ Declining sends no reason, because the wire carries none — the via's rationale is
     * theirs, and a field for it would turn a private judgement into something the
     * requester could be shown.
     */
    it('declines with the decision and nothing else', async () => {
      const api = await mountInbox([VIA_ROW]);

      await mounted().run(() => {
        requireElement(mounted().container, '[data-testid="intro-decline-button"]').click();
      });

      expect(api.calls.filter((call) => call.kind === 'mutate')).toEqual([
        {
          kind: 'mutate',
          path: 'intros.decide',
          input: { introRequestId: 'request-1', decision: 'decline' },
        },
      ]);
    });

    // An absent card is what the wire sends when the request outlived the relationship
    // that carried it. It renders as no name — never one rebuilt from the id.
    it('renders a withheld requester with no name and no identifier', async () => {
      await mountInbox([{ ...VIA_ROW, requester: WITHHELD_REQUESTER }]);

      const container = mounted().container;

      expect(
        requireElement(container, '[data-testid="intro-inbox-via-row"]').textContent,
      ).toContain('Private connection');
      expect(container.innerHTML).not.toContain(WITHHELD_REQUESTER.userId);
    });
  });

  describe('a row that is an introduction already made to this viewer', () => {
    /*
     * ⚠ Branching on `role` is a rule, not a layout preference: the server refuses a
     * decision from anybody but the named via, so Pass on / Decline here would be controls
     * whose only outcome is `INTRO_UNAVAILABLE`.
     */
    it('shows who was introduced and their note, and offers no decision', async () => {
      await mountInbox([TARGET_ROW]);

      const row = requireElement(mounted().container, '[data-testid="intro-inbox-target-row"]');

      expect(row.textContent).toContain('Lena');
      expect(row.textContent).toContain('I heard you fix bikes.');
      expect(row.querySelector('[data-testid="intro-pass-on-button"]')).toBeNull();
      expect(row.querySelector('[data-testid="intro-decline-button"]')).toBeNull();
    });

    it('sits beside an ask without borrowing its controls', async () => {
      await mountInbox([VIA_ROW, TARGET_ROW]);

      const container = mounted().container;

      expect(allElements(container, '[data-testid="intro-inbox-via-row"]')).toHaveLength(1);
      expect(allElements(container, '[data-testid="intro-inbox-target-row"]')).toHaveLength(1);
      expect(allElements(container, '[data-testid="intro-pass-on-button"]')).toHaveLength(1);
    });
  });

  it('says a decision was refused without explaining why', async () => {
    await mountInbox([VIA_ROW], () => {
      throw Object.assign(new Error('refused'), {
        data: { code: 'NOT_FOUND', applicationCode: 'INTRO_UNAVAILABLE' },
      });
    });

    await mounted().run(() => {
      requireElement(mounted().container, '[data-testid="intro-pass-on-button"]').click();
    });

    expect(
      requireElement(mounted().container, '[data-testid="intro-inbox-error"]').textContent,
    ).toBe('That introduction is not available.');
  });
});
