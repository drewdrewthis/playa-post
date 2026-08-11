import { INTRO_REQUEST_STATUS, type IntroOutboxRow } from '@playa-post/contracts';

import {
  INTRO_NOT_PASSED_ON_LINE,
  INTRO_PASSED_ON_LINE,
  introPendingLabel,
  introPersonName,
} from './intro-copy';

/**
 * Where the viewer already stands with one particular person, read off their own outbox.
 *
 * This is what turns the person sheet's affordance from "Request an intro" into "Intro
 * pending via Lena" — and it is the *client's* half of a server rule: while a request is
 * open, `intro_requests_open_per_pair_idx` refuses a second one for the pair with any
 * via. Offering the control anyway would be offering a button whose only outcome is
 * `INTRO_UNAVAILABLE`.
 */
export type IntroStanding =
  /** Nothing asked, or nothing that still says anything. Offer the control. */
  | { readonly kind: 'none' }
  /** An ask is open with this person. `line` is what to render instead of a control. */
  | { readonly kind: 'pending'; readonly line: string }
  /** The via declined. `line` says so — and there is deliberately nothing to press. */
  | { readonly kind: 'declined'; readonly line: string }
  /** The via passed it on. */
  | { readonly kind: 'passed-on'; readonly line: string };

/**
 * Read the viewer's outbox as an answer about one target.
 *
 * ⚠ **An open request wins over any decided one**, regardless of dates. A requester who
 * was declined last week and asked again through somebody else has one open ask and one
 * settled record; rendering the decline would tell them their live request is dead.
 *
 * Among decided rows the newest is the one that speaks, compared on `createdAt` rather
 * than trusting arrival order — the contract says newest first, and a read model that
 * quietly changes its sort must not silently change what this screen says.
 *
 * ⚠ **Call this with a settled read only.** There is no `undefined` arm on purpose: an
 * in-flight outbox rendered as `none` would flash the control at somebody who already
 * has an ask open with this person.
 *
 * @param rows - every row of `intros.listOutbox`, not just this target's.
 * @param targetUserId - the person whose sheet is open.
 */
export function describeIntroStanding(
  rows: readonly IntroOutboxRow[],
  targetUserId: string,
): IntroStanding {
  const mine = rows.filter((row) => row.targetUserId === targetUserId);

  const open = mine.find((row) => row.status === INTRO_REQUEST_STATUS.requested);

  if (open !== undefined) {
    return { kind: 'pending', line: introPendingLabel(introPersonName(open.via)) };
  }

  const latest = mine.reduce<IntroOutboxRow | undefined>(
    (newest, row) => (newest === undefined || row.createdAt > newest.createdAt ? row : newest),
    undefined,
  );

  if (latest === undefined) {
    return { kind: 'none' };
  }

  // ⚠ **Do not add an arm for `accepted` or `target_declined`** (#166). They exist in the
  // status vocabulary and never reach this read: `intros.listOutbox` reports the *via's*
  // decision, because a target who could be seen refusing cannot safely refuse. An
  // acceptance still reaches the requester — as a connection on their graph, which is the
  // target's own disclosure rather than this line's.
  return latest.status === INTRO_REQUEST_STATUS.declined
    ? { kind: 'declined', line: INTRO_NOT_PASSED_ON_LINE }
    : { kind: 'passed-on', line: INTRO_PASSED_ON_LINE };
}
