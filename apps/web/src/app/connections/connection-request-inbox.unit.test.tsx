// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import { CONNECTION_REQUEST_DECISION } from '@playa-post/contracts';

import {
  createFakeApi,
  mountWithApi,
  requireElement,
  type MountedTree,
} from '../testing/mount-with-api';

import {
  CONNECTION_REQUEST_ANSWER_LINE,
  CONNECTION_REQUEST_CONFIRMATION_LINE,
} from './connection-request-copy';
import { ConnectionRequestInbox } from './connection-request-inbox';

/**
 * The owner's inbox — the surface that makes the owner the gate (issue #206).
 *
 * ⚠ jsdom, by the per-file pragma above: the `unit` project runs in `node`, and only the
 * files that render React ask for a DOM.
 */
const LIST_PATH = 'connections.requests.listInbox';
const DECIDE_PATH = 'connections.requests.decide';

const ROW = {
  id: '33333333-3333-4333-8333-333333333333',
  createdAt: '2026-08-13T12:00:00.000Z',
  requester: {
    userId: '22222222-2222-4222-8222-222222222222',
    disclosure: 'full',
    displayName: 'Dusty',
    handle: 'dusty',
  },
};

let tree: MountedTree | null = null;

afterEach(async () => {
  const mounted = tree;
  tree = null;
  if (mounted !== null) {
    await mounted.unmount();
  }
});

function withRows(rows: readonly unknown[], decide?: () => unknown) {
  return createFakeApi({
    [LIST_PATH]: () => rows,
    [DECIDE_PATH]:
      decide ??
      (() => ({ id: ROW.id, status: 'accepted', createdAt: ROW.createdAt, decidedAt: ROW.createdAt })),
  });
}

describe('ConnectionRequestInbox', () => {
  /*
   * The graph screen's subject is the network. An empty state here would put "no requests"
   * on it every time anybody opened it — including while the read is still in flight, which
   * is most of the first second.
   */
  it('renders nothing at all when nothing is waiting', async () => {
    tree = await mountWithApi(<ConnectionRequestInbox />, withRows([]));

    expect(tree.container.querySelector('[data-testid="connection-request-inbox"]')).toBeNull();
  });

  it('names the requester and says what each answer does, before either is pressed', async () => {
    tree = await mountWithApi(<ConnectionRequestInbox />, withRows([ROW]));

    const row = requireElement(tree.container, '[data-testid="connection-request-row"]');
    expect(row.textContent).toContain('Dusty');

    /*
     * ⚠ **Load-bearing, not decoration.** A request arrives from somebody holding this
     * viewer's own published link, and a reader who does not know that refusing reaches
     * nobody is a reader under obligation. The whole product argument for making the owner
     * the gate collapses if saying no feels visible.
     */
    expect(row.textContent).toContain(CONNECTION_REQUEST_ANSWER_LINE);
  });

  it('accepts through connections.requests.decide, naming the row and the decision', async () => {
    const api = withRows([ROW]);
    tree = await mountWithApi(<ConnectionRequestInbox />, api);

    await tree.run(() => {
      requireElement<HTMLButtonElement>(
        tree?.container ?? document.body,
        '[data-testid="connection-request-accept-button"]',
      ).click();
    });

    const decisions = api.calls.filter((call) => call.path === DECIDE_PATH);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.input).toEqual({
      connectionRequestId: ROW.id,
      decision: CONNECTION_REQUEST_DECISION.accept,
    });
  });

  it('declines through the same procedure, with the other decision', async () => {
    const api = withRows([ROW], () => ({
      id: ROW.id,
      status: 'declined',
      createdAt: ROW.createdAt,
      decidedAt: ROW.createdAt,
    }));
    tree = await mountWithApi(<ConnectionRequestInbox />, api);

    await tree.run(() => {
      requireElement<HTMLButtonElement>(
        tree?.container ?? document.body,
        '[data-testid="connection-request-decline-button"]',
      ).click();
    });

    expect(api.calls.filter((call) => call.path === DECIDE_PATH)[0]?.input).toEqual({
      connectionRequestId: ROW.id,
      decision: CONNECTION_REQUEST_DECISION.decline,
    });
  });

  /*
   * ⚠ **The confirmation holds the section open after the last row goes.** An answered row
   * disappears on the re-read, and a card vanishing under the finger with nothing said reads
   * as a failure — especially to a screen-reader user, whose focus was on the button that
   * just left the tree.
   *
   * ⚠ And the acceptance line is in the **past tense**, which is a deliberate difference
   * from the intro inbox's "you are being connected": here the edge is written by the same
   * transaction, so the graph is already right.
   */
  it('announces the decision in a live region once the row is gone', async () => {
    let rows: readonly unknown[] = [ROW];
    const api = createFakeApi({
      [LIST_PATH]: () => rows,
      [DECIDE_PATH]: () => {
        rows = [];
        return { id: ROW.id, status: 'accepted', createdAt: ROW.createdAt, decidedAt: ROW.createdAt };
      },
    });

    tree = await mountWithApi(<ConnectionRequestInbox />, api);
    await tree.run(() => {
      requireElement<HTMLButtonElement>(
        tree?.container ?? document.body,
        '[data-testid="connection-request-accept-button"]',
      ).click();
    });

    const confirmation = requireElement(
      tree.container,
      '[data-testid="connection-request-inbox-confirmation"]',
    );
    expect(confirmation.textContent).toBe(CONNECTION_REQUEST_CONFIRMATION_LINE.accept);
    expect(confirmation.getAttribute('role')).toBe('status');
    expect(tree.container.querySelector('[data-testid="connection-request-row"]')).toBeNull();
  });

  /*
   * ⚠ A refusal here is usually the row having been decided on another device or having
   * lapsed, so the honest response is to re-read rather than leave a stale request on screen
   * with an error under it — and the message must not invent a cause the server withheld.
   */
  it('renders the server’s flat refusal and re-reads the list', async () => {
    const api = createFakeApi({
      [LIST_PATH]: () => [ROW],
      [DECIDE_PATH]: () => {
        throw new Error('the server refused this');
      },
    });

    tree = await mountWithApi(<ConnectionRequestInbox />, api);
    await tree.run(() => {
      requireElement<HTMLButtonElement>(
        tree?.container ?? document.body,
        '[data-testid="connection-request-accept-button"]',
      ).click();
    });

    const error = requireElement(
      tree.container,
      '[data-testid="connection-request-inbox-error"]',
    );
    expect(error.getAttribute('role')).toBe('alert');
    // Two reads: the mount's, and the one `onSettled` triggered.
    expect(api.calls.filter((call) => call.path === LIST_PATH).length).toBeGreaterThan(1);
  });

  /*
   * ⚠ Its own test id rather than the intro inbox's. The two press different procedures
   * with different consequences, and one id shared across them would let a walk that meant
   * to decline a connection request silently decline an introduction.
   */
  it('uses test ids distinct from the intro inbox’s', async () => {
    tree = await mountWithApi(<ConnectionRequestInbox />, withRows([ROW]));

    expect(tree.container.querySelector('[data-testid="intro-accept-button"]')).toBeNull();
    expect(tree.container.querySelector('[data-testid="intro-target-decline-button"]')).toBeNull();
    expect(
      tree.container.querySelector('[data-testid="connection-request-accept-button"]'),
    ).not.toBeNull();
  });
});
