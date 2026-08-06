import type { BoardQuery } from '../../views/views.module';
import type { NotifyMeMatched } from '../domain/notification.events';
import type { NotifyMeMatch } from '../domain/notify-me-match';

/** What "does this bulletin match, for this person, right now" is asked with. */
export interface AuthorizedMatchQuery {
  /**
   * Whose eyes to evaluate through.
   *
   * A plain `string`, not a `ViewerId`, and the difference is the point: a `ViewerId`
   * is minted from an `Actor` at the tRPC context boundary and cannot exist here
   * (`shared/auth/viewer-id.ts` — "if a call site cannot reach an `Actor` … give it its
   * own non-viewer-scoped query"). This identifier comes from a saved query's
   * `owner_id`, which is stored state, never request input — the provenance ADR-0002
   * §5a actually cares about.
   */
  readonly recipientId: string;
  readonly bulletinId: string;
  /** The recipient's saved filter, already validated by `modules/views`' grammar. */
  readonly query: BoardQuery;
}

/** What recording one evaluation's outcome is given. */
export interface RecordMatchesCommand {
  /** The triggering `BulletinCreated` event, whose receipt this write claims. */
  readonly eventId: string;
  readonly processedAt: Date;
  /** May be empty — "nobody matched" is still a processed event. */
  readonly matches: readonly NotifyMeMatched[];
}

/** What flushing one window is given. */
export interface CompleteWindowCommand {
  readonly matches: readonly NotifyMeMatch[];
  readonly processedAt: Date;
  /**
   * Re-check authorization and dispatch — run **inside** the receipt transaction.
   *
   * ADR-0002:274-279 requires exactly this ordering: a push can be *computed* before a
   * block and *sent* after it, so send-time evaluation is the authorization and
   * compute-time evaluation is only an optimization. Passing the dispatch in as a
   * callback is what makes "inside the same transaction" structural rather than a
   * comment two layers apart have to agree on.
   *
   * @param claimed - The subset of `matches` whose receipts this call actually wrote.
   *   Never empty; the repository skips the callback entirely when it claims nothing.
   */
  dispatch(claimed: readonly NotifyMeMatch[]): Promise<void>;
}

/**
 * The port onto computed matches — the notification side of `app.outbox_events`.
 *
 * Declared in `application/` rather than `domain/` for `modules/graph`'s reason: these
 * are delivery-ledger operations over a shared table, not an aggregate this module
 * reconstructs.
 */
export interface NotifyMeMatchRepository {
  /**
   * Re-read the bulletin **as the recipient** and test their saved filter against it.
   *
   * The re-read goes through `app.visible_bulletins`, the one definition of "which
   * bulletins can this viewer see" (ADR-0002 §6) — never `app.bulletins` directly, and
   * never a second reachability derivation. A consumer acting on a copy of the event's
   * payload instead would deliver content the *current* authorization state no longer
   * permits, which is precisely what ADR-0006 says a payload must not enable.
   *
   * @returns `false` when the bulletin is invisible to this recipient, archived, or
   *   simply does not satisfy their filter. The three are one answer on purpose: this
   *   is a matching question, and telling them apart would require the caller to know
   *   things about a bulletin it is not entitled to.
   */
  isAuthorizedMatch(command: AuthorizedMatchQuery): Promise<boolean>;

  /**
   * Write the triggering event's receipt and every computed match, **atomically**.
   *
   * The receipt goes first. A redelivered `BulletinCreated` therefore claims nothing,
   * writes no second match, and returns — which is M2-AC8, obtained from the primary
   * key rather than from bespoke dedup logic (ADR-0006).
   */
  recordMatches(command: RecordMatchesCommand): Promise<void>;

  /**
   * Every computed match still awaiting a flush.
   *
   * @returns Oldest first. Empty when nothing has matched since the last flush, which
   *   is the ordinary case for a scheduled job.
   */
  findPendingMatches(): Promise<readonly NotifyMeMatch[]>;

  /**
   * Claim one window's matches, run `dispatch`, and commit — or roll all of it back.
   *
   * The receipt rows are what stop a second flush from re-delivering a window, and
   * they are written **even when nothing is sent**: a recipient who lost authorization
   * between compute and flush has been correctly refused, and a refusal that left no
   * receipt would be retried forever (M2-AC22 — "the receipt records the suppression").
   */
  completeWindow(command: CompleteWindowCommand): Promise<void>;
}
