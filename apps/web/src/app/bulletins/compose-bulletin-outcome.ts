import type { PendingMutationState } from '../offline/database';

/**
 * What happened to a queued bulletin, once the drain has settled.
 *
 * `posted` and `queued` are both successes — the write is safe either way, which is the
 * whole point of queueing online and offline alike — and differ only in what the toast
 * says. `refused` is the one that keeps the user on the form.
 */
export type SubmissionOutcomeKind = 'posted' | 'queued' | 'refused';

export interface SubmissionOutcome {
  readonly kind: SubmissionOutcomeKind;
  /** Ready to render. Never a bare code, and never an invented explanation of one. */
  readonly message: string;
}

/**
 * The two server codes this form can actually provoke, in words.
 *
 * ⚠ **Only codes whose remedy the form can name belong here.** Anything else is shown as
 * itself by {@link describeSubmissionOutcome} — a friendly sentence written over a code
 * nobody has read is how a user ends up retrying the one thing that cannot work.
 */
const REFUSAL_MESSAGE: Readonly<Record<string, string>> = {
  BULLETIN_EXPIRY_INVALID: 'That expiry has already passed. Pick another and post again.',
  BULLETIN_CONTENT_INVALID:
    'The server refused this bulletin’s title, body, or location. Shorten it and post again.',
};

/**
 * Read a settled queue row as something to say to the person who pressed Post.
 *
 * ⚠ **`failed` and `conflicted` are both refusals, and neither may be rendered as a
 * success.** A create cannot really conflict today, but the state is representable, and
 * a switch that quietly let an unhandled state fall through to "Posted" would tell
 * someone their bulletin is on the board when it is not.
 *
 * An expiry refusal is a genuine case rather than a defensive one: a bulletin composed
 * offline with a 24h expiry and drained two days later carries a moment that has since
 * passed, and the server is right to refuse it.
 *
 * @param state - The row's state after `SyncRunner.drain()` has settled it.
 * @param lastError - The server's stable code, a transport failure's name, or `null`.
 */
export function describeSubmissionOutcome(
  state: PendingMutationState,
  lastError: string | null,
): SubmissionOutcome {
  switch (state) {
    case 'synced':
      return { kind: 'posted', message: 'Posted — it’s on your board.' };

    case 'pending':
      return { kind: 'queued', message: 'Queued — will sync when you’re back.' };

    case 'inflight':
      return { kind: 'queued', message: 'Still syncing — it will land shortly.' };

    case 'failed':
    case 'conflicted':
      return { kind: 'refused', message: refusalMessage(lastError) };
  }
}

function refusalMessage(code: string | null): string {
  if (code === null) {
    return 'The server refused this bulletin.';
  }

  return REFUSAL_MESSAGE[code] ?? `The server refused this bulletin: ${code}`;
}
