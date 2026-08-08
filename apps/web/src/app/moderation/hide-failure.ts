import type { ModerationTargetRequest, ReportBulletinRequest } from '@playa-post/contracts';

import { applicationErrorCode } from '../api/client';

/** What the board says about a hide that did not reach the server, and what it offers. */
export interface HideFailureNotice {
  /** Ready to render. Never a bare code, and never an invented explanation of one. */
  readonly message: string;
  /**
   * Whether re-sending the **identical** request could succeed.
   *
   * True only for failures the request itself did not cause — a dropped connection, a
   * server that never answered. A refusal the server has already judged comes back
   * `false`, because a "Try again" over it is a button that cannot work.
   */
  readonly retryable: boolean;
  /**
   * Whether the card belongs back on the board.
   *
   * The board hides a card the moment someone reports or dismisses it, which is right
   * while the write is in flight and a lie once it has failed. Almost every failure
   * restores it: the hide did not happen, so the board did not change.
   */
  readonly restoresCard: boolean;
}

/**
 * The bulletin is gone, archived, or was never visible to this viewer — one code for all
 * three, deliberately (`moderation/domain/moderation.errors.ts`).
 *
 * ⚠ **A mirror of the server's constant, not the rule** — the same relationship
 * `REPORT_DETAIL_MAX_LENGTH` has to the domain. `no-web-to-server-internals` forbids
 * importing it, and `packages/contracts` publishes the shapes rather than the codes. If
 * the two drift, this app falls through to {@link unknownRefusal} and shows the code
 * itself, which is wrong-looking rather than wrong.
 */
const TARGET_UNAVAILABLE = 'MODERATION_TARGET_UNAVAILABLE';

/**
 * The refusals of a *report* whose remedy this app can name.
 *
 * ⚠ **Only codes whose remedy the board can state belong here** — the discipline
 * `compose-bulletin-outcome.ts` sets. Anything else is shown as itself, because a
 * friendly sentence written over a code nobody has read is how someone ends up retrying
 * the one thing that cannot work.
 *
 * Both are reachable rather than defensive: the first is what an author gets for
 * reporting their own bulletin, and the second is what the reporter gets if this app's
 * length mirror ever drifts below the server's.
 */
const REPORT_REFUSAL: Readonly<Record<string, string>> = {
  BULLETIN_REPORT_OWN_NOT_ALLOWED: 'You wrote that bulletin. Archive it instead of reporting it.',
  REPORT_DETAIL_INVALID:
    'The stewards need an account of what happened. Yours was blank or too long.',
};

/**
 * Read a failed `moderation.report` or `moderation.dismiss` as something to say to the
 * person who asked for it.
 *
 * ⚠ **No branch may imply the report arrived.** The sheet promises "Your report goes to
 * the stewards, who review it and can remove the post or the person" before the request
 * is made; a failure that says nothing leaves that promise standing over a request that
 * never left the device, and the card comes back on the next reload with no explanation.
 * That silence — not the failure — is what this module exists to end.
 *
 * The two requests are told apart the way the mutation itself tells them apart: a report
 * carries a `reason`, a dismissal carries only a target. They need different words
 * because they made different promises — only one of them involved another person.
 *
 * @param request - The request that failed, exactly as it was sent.
 * @param error - Whatever the client rejected with: a tRPC envelope, or a transport
 * failure with no envelope at all.
 */
export function describeHideFailure(
  request: ReportBulletinRequest | ModerationTargetRequest,
  error: unknown,
): HideFailureNotice {
  const isReport = 'reason' in request;
  const code = applicationErrorCode(error);

  // No envelope means the server never answered — offline, or the connection dropped.
  // The one failure where sending the very same bytes again is the right remedy.
  if (code === null) {
    return {
      message: isReport
        ? 'Your report did not reach the stewards. The bulletin is back on your board.'
        : 'Dismissing that bulletin did not reach the server. It is back on your board.',
      retryable: true,
      restoresCard: true,
    };
  }

  if (code === TARGET_UNAVAILABLE) {
    return {
      message: isReport
        ? 'That bulletin is no longer available, so the stewards were not sent anything.'
        : 'That bulletin is no longer available.',
      retryable: false,
      // The one refusal that leaves the card off the board: the server has said the
      // bulletin is not there to hide, and restoring it would contradict the sentence
      // above it.
      restoresCard: false,
    };
  }

  const refusal = isReport ? REPORT_REFUSAL[code] : undefined;

  return {
    message: refusal ?? unknownRefusal(isReport, code),
    retryable: false,
    restoresCard: true,
  };
}

function unknownRefusal(isReport: boolean, code: string): string {
  return isReport
    ? `The stewards did not get that report: ${code}`
    : `The server refused that dismissal: ${code}`;
}
