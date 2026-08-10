// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import type { IntroOutboxRow, IntroPerson, Person } from '@playa-post/contracts';

import {
  createFakeApi,
  mountWithApi,
  requireElement,
  type MountedTree,
} from '../testing/mount-with-api';

import { PersonSheet } from './person-sheet';

/**
 * The person sheet's intro affordance (issue #89).
 *
 * The trust half of this sheet is #85's and is not re-proven here; what this file holds
 * is the rule that decides *which* of four things the sheet offers about an
 * introduction — and, more importantly, when it offers nothing.
 *
 * ⚠ jsdom, by the per-file pragma above: the `unit` project runs in `node`.
 */

const LENA: IntroPerson = { userId: 'lena-id', disclosure: 'full', displayName: 'Lena' };

function person(degree: number): Person {
  return {
    userId: 'kiki-id',
    degree,
    disclosure: 'full',
    displayName: 'Kiki',
    trust: null,
  };
}

function outboxRow(status: IntroOutboxRow['status']): IntroOutboxRow {
  return {
    id: `request-${status}`,
    status,
    targetUserId: 'kiki-id',
    createdAt: '2026-08-10T09:00:00.000Z',
    via: LENA,
  };
}

let tree: MountedTree | null = null;

afterEach(async () => {
  const mountedTree = tree;

  tree = null;

  if (mountedTree !== null) {
    await mountedTree.unmount();
  }
});

async function openSheet(
  degree: number,
  outbox: readonly IntroOutboxRow[],
  connection: (input: unknown) => unknown = () => null,
): Promise<void> {
  const api = createFakeApi({
    'connections.connection.get': connection,
    'intros.listOutbox': () => outbox,
    'intros.viaCandidates': () => [LENA],
  });

  tree = await mountWithApi(
    <PersonSheet
      person={person(degree)}
      onClose={() => {
        /* the sheet's own exits are proven in `intro-sheet.unit.test.tsx` */
      }}
    />,
    api,
  );
}

function container(): HTMLElement {
  if (tree === null) {
    throw new Error('the sheet is not mounted');
  }

  return tree.container;
}

describe('the person sheet, on somebody two hops away', () => {
  it('offers the introduction as its primary action', async () => {
    await openSheet(2, []);

    const button = requireElement(
      container(),
      '[data-testid="person-sheet-request-intro-button"]',
    );

    expect(button.textContent).toBe('Request an intro to Kiki');
    expect(container().querySelector('[data-testid="person-sheet-intro-standing"]')).toBeNull();
  });

  it('opens the intro sheet over it', async () => {
    await openSheet(2, []);

    expect(container().querySelector('[data-testid="intro-sheet"]')).toBeNull();

    if (tree === null) {
      throw new Error('the sheet is not mounted');
    }

    await tree.run(() => {
      requireElement(container(), '[data-testid="person-sheet-request-intro-button"]').click();
    });

    expect(container().querySelector('[data-testid="intro-sheet"]')).not.toBeNull();
  });

  /*
   * ⚠ While a request for this pair is open the server refuses a second one with any via
   * (`intro_requests_open_per_pair_idx`). Leaving the control up would offer a button
   * whose only outcome is `INTRO_UNAVAILABLE`.
   */
  it('reports an open ask instead of offering another', async () => {
    await openSheet(2, [outboxRow('requested')]);

    expect(
      requireElement(container(), '[data-testid="person-sheet-intro-standing"]').textContent,
    ).toBe('Intro pending via Lena');
    expect(
      container().querySelector('[data-testid="person-sheet-request-intro-button"]'),
    ).toBeNull();
  });

  /*
   * ⚠ No reason, and nothing to press. The wire carries no reason because there is none
   * to send, and a re-ask control beside a decline turns one person's judgement into a
   * prompt to overturn it.
   */
  it('reports a decline with no reason and no way to ask again', async () => {
    await openSheet(2, [outboxRow('declined')]);

    const standing = requireElement(
      container(),
      '[data-testid="person-sheet-intro-standing"]',
    ).textContent;

    expect(standing).toContain('not passed on');
    expect(standing).not.toMatch(/because|why|reason|again|yet/i);
    expect(
      container().querySelector('[data-testid="person-sheet-request-intro-button"]'),
    ).toBeNull();
  });

  it('reports one that was passed on', async () => {
    await openSheet(2, [outboxRow('passed_on')]);

    expect(
      requireElement(container(), '[data-testid="person-sheet-intro-standing"]').textContent,
    ).toContain('Passed on');
  });
});

describe('the person sheet, on somebody further away', () => {
  /*
   * ⚠ `app.intro_via_candidates` returns nobody past two hops, so a control here would
   * open a sheet with nothing to send. The copy says what the eligibility SQL does.
   */
  it('says intros travel one hop, and offers nothing', async () => {
    await openSheet(4, []);

    expect(
      requireElement(container(), '[data-testid="person-sheet-intro-hint"]').textContent,
    ).toContain('intros travel one hop');
    expect(
      container().querySelector('[data-testid="person-sheet-request-intro-button"]'),
    ).toBeNull();
  });

  it('keeps saying it out at the sixth degree, which a reach setting can reach', async () => {
    await openSheet(6, []);

    expect(
      requireElement(container(), '[data-testid="person-sheet-intro-hint"]').textContent,
    ).toContain('intros travel one hop');
  });
});

describe('the connection read behind the trust half', () => {
  /*
   * ⚠ The wire never resolves `null`: "no connection" is a `NOT_FOUND` refusal carrying
   * `NOT_CONNECTED`, indistinguishable from a stranger's (B6). Read as a failure, every
   * sheet past the first degree opens on "That did not load" — which is what shipped
   * between #80 and this test.
   */
  it("reads the server's NOT_CONNECTED refusal as not-connected, not as a failure", async () => {
    await openSheet(2, [], () => {
      throw Object.assign(new Error('refused'), {
        data: { code: 'NOT_FOUND', applicationCode: 'NOT_CONNECTED' },
      });
    });

    expect(
      requireElement(container(), '[data-testid="person-sheet-not-connected"]').textContent,
    ).toContain('not connected');
    expect(container().textContent).not.toContain('That did not load');
    expect(
      container().querySelector('[data-testid="person-sheet-request-intro-button"]'),
    ).not.toBeNull();
  });

  it('still reports a genuine failure as one', async () => {
    await openSheet(2, [], () => {
      throw new Error('the network went away');
    });

    expect(requireElement(container(), '[role="alert"]').textContent).toContain(
      'That did not load',
    );
  });
});

describe('the person sheet, on a direct connection', () => {
  // Nobody needs an introduction to somebody they already know, and the hint about
  // pinning belongs to the screens that offer pinning.
  it('says nothing about intros at all', async () => {
    await openSheet(1, [], () => ({ status: 'accepted', trust: 20 }));

    expect(
      container().querySelector('[data-testid="person-sheet-request-intro-button"]'),
    ).toBeNull();
    expect(container().querySelector('[data-testid="person-sheet-intro-hint"]')).toBeNull();
    expect(container().querySelector('[data-testid="person-sheet-intro-standing"]')).toBeNull();
  });
});
