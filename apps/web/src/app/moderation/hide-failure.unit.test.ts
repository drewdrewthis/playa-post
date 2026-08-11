import { describe, expect, it } from 'vitest';

import { REPORT_REASON, type ModerationTargetRequest, type ReportBulletinRequest } from '@playa-post/contracts';

import { describeHideFailure } from './hide-failure';

const BULLETIN_ID = '33333333-3333-4333-8333-333333333333';

const REPORT: ReportBulletinRequest = {
  bulletinId: BULLETIN_ID,
  reason: REPORT_REASON.scamOrFraud,
  detail: 'Asked for a deposit up front and the camp does not exist.',
};

const DISMISSAL: ModerationTargetRequest = { bulletinId: BULLETIN_ID };

/**
 * A tRPC rejection carrying an application code, in the envelope shape
 * `shared/trpc/trpc.ts`'s `errorFormatter` actually produces.
 *
 * Hand-built rather than provoked through a real client on purpose: this module reads
 * one field off an envelope, and the field is the whole contract. `applicationErrorCode`
 * is the shared reader and is exercised here through the module that calls it.
 */
function refusal(applicationCode: string): unknown {
  return Object.assign(new Error('refused'), { data: { code: 'BAD_REQUEST', applicationCode } });
}

/** What a dropped connection looks like: a rejection with no envelope at all. */
const TRANSPORT_FAILURE: unknown = new TypeError('Failed to fetch');

/**
 * What to say when a hide did not reach the server.
 *
 * ⚠ **The one rule every case below shares: never imply the stewards got the report.**
 * The report sheet promises "Your report goes to the stewards, who review it" — a failure
 * that says nothing leaves that promise standing over a request that never arrived, which
 * is the defect this module exists to close.
 *
 * Lives here rather than inside `board.tsx` so it can be asserted without a DOM, the same
 * reason `report-abuse-draft.ts` and `compose-bulletin-outcome.ts` are separate modules.
 */
describe('describeHideFailure', () => {
  describe('a connection that dropped', () => {
    it('tells a reporter the stewards did not get it', () => {
      const notice = describeHideFailure(REPORT, TRANSPORT_FAILURE);

      expect(notice.message).toBe(
        'Your report did not reach the stewards. The bulletin is back on your board.',
      );
    });

    it('offers to send that same report again', () => {
      expect(describeHideFailure(REPORT, TRANSPORT_FAILURE).retryable).toBe(true);
    });

    it('puts the card back, because nothing about the board changed', () => {
      expect(describeHideFailure(REPORT, TRANSPORT_FAILURE).restoresCard).toBe(true);
    });

    it('tells someone who dismissed that the dismissal did not land either', () => {
      const notice = describeHideFailure(DISMISSAL, TRANSPORT_FAILURE);

      expect(notice.message).toBe(
        'Dismissing that bulletin did not reach the server. It is back on your board.',
      );
      expect(notice.retryable).toBe(true);
      expect(notice.restoresCard).toBe(true);
    });
  });

  describe('a bulletin the server will not moderate', () => {
    it('says nothing was sent, rather than leaving the sheet’s promise standing', () => {
      const notice = describeHideFailure(REPORT, refusal('MODERATION_TARGET_UNAVAILABLE'));

      expect(notice.message).toBe(
        'That bulletin is no longer available, so the stewards were not sent anything.',
      );
    });

    it('does not offer a retry that cannot succeed', () => {
      expect(describeHideFailure(REPORT, refusal('MODERATION_TARGET_UNAVAILABLE')).retryable).toBe(
        false,
      );
    });

    /*
     * The one refusal that leaves the card off the board. Everywhere else the hide simply
     * did not happen and the card belongs back; here the server has said the bulletin is
     * not there to hide, and putting it back would contradict the sentence above it.
     */
    it('leaves the card off the board, because the server says it is not there', () => {
      expect(
        describeHideFailure(REPORT, refusal('MODERATION_TARGET_UNAVAILABLE')).restoresCard,
      ).toBe(false);
    });

    it('says the same thing to a dismissal, without inventing a steward', () => {
      const notice = describeHideFailure(DISMISSAL, refusal('MODERATION_TARGET_UNAVAILABLE'));

      expect(notice.message).toBe('That bulletin is no longer available.');
      expect(notice.restoresCard).toBe(false);
    });
  });

  describe('a report the server refuses on its merits', () => {
    it('points an author at removal, which is the operation they wanted', () => {
      const notice = describeHideFailure(REPORT, refusal('BULLETIN_REPORT_OWN_NOT_ALLOWED'));

      expect(notice.message).toBe('You wrote that bulletin. Remove it instead of reporting it.');
      expect(notice.retryable).toBe(false);
      expect(notice.restoresCard).toBe(true);
    });

    it('says which half of the account the server rejected', () => {
      const notice = describeHideFailure(REPORT, refusal('REPORT_DETAIL_INVALID'));

      expect(notice.message).toBe(
        'The stewards need an account of what happened. Yours was blank or too long.',
      );
      expect(notice.retryable).toBe(false);
      expect(notice.restoresCard).toBe(true);
    });
  });

  describe('a code this app has never been taught', () => {
    /*
     * The discipline `compose-bulletin-outcome.ts` sets: a friendly sentence written over
     * a code nobody has read is how someone ends up retrying the one thing that cannot
     * work. The code is shown as itself instead.
     */
    it('shows the code rather than inventing an explanation of it', () => {
      expect(describeHideFailure(REPORT, refusal('MODERATION_QUOTA_EXCEEDED')).message).toBe(
        'The stewards did not get that report: MODERATION_QUOTA_EXCEEDED',
      );
      expect(describeHideFailure(DISMISSAL, refusal('MODERATION_QUOTA_EXCEEDED')).message).toBe(
        'The server refused that dismissal: MODERATION_QUOTA_EXCEEDED',
      );
    });

    it('does not offer a retry of a request the server has already judged', () => {
      expect(describeHideFailure(REPORT, refusal('MODERATION_QUOTA_EXCEEDED')).retryable).toBe(
        false,
      );
    });
  });

  it('never tells a reporter their report arrived', () => {
    const everyFailure: readonly unknown[] = [
      TRANSPORT_FAILURE,
      refusal('MODERATION_TARGET_UNAVAILABLE'),
      refusal('BULLETIN_REPORT_OWN_NOT_ALLOWED'),
      refusal('REPORT_DETAIL_INVALID'),
      refusal('MODERATION_QUOTA_EXCEEDED'),
    ];

    for (const error of everyFailure) {
      const { message } = describeHideFailure(REPORT, error);

      expect(message).not.toMatch(/will review|reviewing|reported|sent to the stewards/i);
    }
  });
});
