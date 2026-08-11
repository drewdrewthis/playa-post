import { describe, expect, it } from 'vitest';

import {
  BOARD_VIEW,
  describeDismissedList,
  describeUndismissFailure,
  parseBoardView,
} from './dismissed-view';

/**
 * `specs/features/moderation-report-dismiss.feature` — the Dismissed view's own decisions
 * (#170), at the only level this app can assert them: the unit project runs in
 * `environment: 'node'` with no component harness, so anything left inside a component is
 * untestable by construction.
 */
describe('parseBoardView', () => {
  it('reads the dismissed view from the URL', () => {
    expect(parseBoardView('dismissed')).toBe(BOARD_VIEW.dismissed);
  });

  it.each([null, '', 'board', 'Dismissed', 'dismisssed', 'reported'])(
    'falls back to the board for %j rather than refusing or guessing',
    (raw) => {
      expect(parseBoardView(raw)).toBe(BOARD_VIEW.board);
    },
  );

  it('never reads a near-miss as the dismissed view', () => {
    // A typo must not open somebody's private list. Asserted separately from the table
    // above because it is the security-shaped half of the same rule.
    expect(parseBoardView('dismiss')).toBe(BOARD_VIEW.board);
  });
});

describe('describeDismissedList', () => {
  it('renders rows when there are any', () => {
    expect(describeDismissedList({ itemCount: 3, dismissed: 'settled' })).toEqual({
      items: true,
      error: null,
      empty: null,
    });
  });

  it('says nothing at all while the read is pending', () => {
    // Nothing is known yet, so nothing may be claimed — least of all that the list is
    // empty.
    expect(describeDismissedList({ itemCount: 0, dismissed: 'pending' })).toEqual({
      items: false,
      error: null,
      empty: null,
    });
  });

  it('reports a failed read as a failure, never as an empty list', () => {
    const region = describeDismissedList({ itemCount: 0, dismissed: 'error' });

    expect(region.items).toBe(false);
    expect(region.empty).toBeNull();
    expect(region.error).toContain('could not be loaded');
  });

  it('offers the empty line only once the read has settled with nothing', () => {
    const region = describeDismissedList({ itemCount: 0, dismissed: 'settled' });

    expect(region.items).toBe(false);
    expect(region.error).toBeNull();
    expect(region.empty).toBe(
      'Nothing dismissed. Anything you take off your board shows up here.',
    );
  });
});

describe('describeUndismissFailure', () => {
  /** A refusal shaped the way `hide-failure.unit.test.ts` shapes one. */
  function refusalWithCode(applicationCode: string): unknown {
    return Object.assign(new Error('refused'), {
      data: { code: 'BAD_REQUEST', applicationCode },
    });
  }

  it('offers a retry when the request never reached a verdict', () => {
    const notice = describeUndismissFailure(new Error('Failed to fetch'));

    expect(notice.retryable).toBe(true);
    expect(notice.message).toContain('connection');
  });

  it('does not offer a retry over a refusal the server has already judged', () => {
    const notice = describeUndismissFailure(refusalWithCode('MODERATION_TARGET_UNAVAILABLE'));

    expect(notice.retryable).toBe(false);
    expect(notice.message).toBe(
      'That post is no longer available, so it cannot go back on your board.',
    );
  });

  it('shows an unrecognised code as itself rather than inventing an explanation', () => {
    const notice = describeUndismissFailure(refusalWithCode('SOMETHING_NEW'));

    expect(notice.retryable).toBe(false);
    expect(notice.message).toContain('SOMETHING_NEW');
  });
});
