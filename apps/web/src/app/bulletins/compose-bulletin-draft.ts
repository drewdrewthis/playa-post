import type { BulletinType, CreateBulletinRequest } from '@playa-post/contracts';

/**
 * Longest title the compose form will let a user post.
 *
 * ⚠ **A mirror, not the rule.** The rule is
 * `apps/server/src/modules/bulletins/domain/bulletin-content.ts`, which the web app
 * cannot import (`no-web-to-server-internals`), and which stays authoritative: a draft
 * this file waves through is still refused by the server, and that refusal is rendered
 * verbatim rather than swallowed (`compose-bulletin-outcome.ts`). The mirror exists so a
 * user finds out at the keystroke instead of after a round trip — if the two ever drift,
 * the server wins and the form is merely early.
 */
export const BULLETIN_TITLE_MAX_LENGTH = 120;

/** Longest body the compose form will let a user post. See {@link BULLETIN_TITLE_MAX_LENGTH}. */
export const BULLETIN_BODY_MAX_LENGTH = 4000;

/** Longest location line the compose form will let a user post. See {@link BULLETIN_TITLE_MAX_LENGTH}. */
export const BULLETIN_LOC_MAX_LENGTH = 120;

/** One of {@link EXPIRY_PRESETS}' ids. */
export type ExpiryPreset = 'none' | '24h' | '3d' | '1w';

/**
 * The expiry choices the sheet offers, in the comp's order with one addition in front.
 *
 * ⚠ **Presets, not a vocabulary.** The server takes any future ISO-8601 moment and
 * imposes no ceiling (`domain/bulletin-expiry.policy.ts`), so these three are a
 * convenience the UI computes from — never a wire contract. A fourth preset is a line
 * here and nothing else.
 *
 * `none` leads because it is the server's own default: a bulletin with no `expiresAt`
 * never expires, and the comp's `3d` default would silently start deleting people's
 * posts a product decision has not been taken to delete.
 */
export const EXPIRY_PRESETS: readonly { readonly id: ExpiryPreset; readonly label: string }[] = [
  { id: 'none', label: 'No expiry' },
  { id: '24h', label: '24h' },
  { id: '3d', label: '3 days' },
  { id: '1w', label: '1 week' },
];

/** The preset a fresh draft starts on. See {@link EXPIRY_PRESETS}. */
export const DEFAULT_EXPIRY_PRESET: ExpiryPreset = 'none';

const HOURS = 60 * 60 * 1000;
const DAYS = 24 * HOURS;

/** How far past `now` each preset reaches. `none` is absent, not zero. */
const PRESET_DURATION_MS: Readonly<Partial<Record<ExpiryPreset, number>>> = {
  '24h': DAYS,
  '3d': 3 * DAYS,
  '1w': 7 * DAYS,
};

/** What the compose sheet holds while it is being filled in. */
export interface BulletinDraft {
  readonly type: BulletinType;
  readonly title: string;
  readonly body: string;
  /** Free text, untrimmed and possibly empty — the field is optional. */
  readonly loc: string;
  readonly expiry: ExpiryPreset;
}

/** Why a field is not postable. `null` means it is. */
export type DraftFieldIssue = 'empty' | 'too-long';

/**
 * What is wrong with a draft, field by field.
 *
 * `empty` and `too-long` are kept apart because the form treats them differently: an
 * empty required field is already announced by the disabled post button, whereas an
 * over-long one is a thing the user did that needs saying out loud.
 */
export interface BulletinDraftIssues {
  readonly title: DraftFieldIssue | null;
  readonly body: DraftFieldIssue | null;
  readonly loc: DraftFieldIssue | null;
  /** True when every field is clear. Drives the post button's disabled state. */
  readonly postable: boolean;
}

/**
 * Turn a preset into the moment to send as `expiresAt`.
 *
 * @param now - The clock, passed in rather than read, so "24h from when?" is a decision
 *   the caller makes once — at queue time — and never re-makes. Recomputing it on a
 *   retry would change the payload the server hashes and turn a replay into
 *   `IDEMPOTENCY_KEY_REUSE`.
 * @returns An ISO-8601 instant, or `undefined` for a bulletin that never expires — which
 *   the payload builder renders as an absent key rather than an explicit `undefined`.
 */
export function expiresAtFor(preset: ExpiryPreset, now: Date): string | undefined {
  const duration = PRESET_DURATION_MS[preset];

  return duration === undefined ? undefined : new Date(now.getTime() + duration).toISOString();
}

/**
 * Check a draft against the server's rules, early.
 *
 * Every bound is measured **after trimming**, which is what the server's content policy
 * does; measuring the raw value would refuse a title the server would have accepted.
 *
 * ⚠ An empty **body** is refused here and accepted by the server. That is the comp's
 * `canPost` (title *and* body non-empty), kept deliberately: a bulletin whose body is
 * blank is a card with nothing to act on. The stricter side is the client's to choose —
 * the reverse, a client accepting what the server refuses, is the bug.
 */
export function inspectBulletinDraft(draft: BulletinDraft): BulletinDraftIssues {
  const title = issueFor(draft.title, BULLETIN_TITLE_MAX_LENGTH, true);
  const body = issueFor(draft.body, BULLETIN_BODY_MAX_LENGTH, true);
  const loc = issueFor(draft.loc, BULLETIN_LOC_MAX_LENGTH, false);

  return { title, body, loc, postable: title === null && body === null && loc === null };
}

/**
 * Freeze a draft into the payload that will be queued.
 *
 * ⚠ **Called once, at queue time, and never again.** The server hashes this object to
 * tell a replay from a duplicate (`offline/database.ts`), so a caller that rebuilds it
 * on a retry — even identically-looking, with a fresh `now` — gets a rejection instead of
 * an idempotent replay.
 *
 * Absent keys rather than explicit `undefined` for the two optionals: `loc` that trims to
 * nothing means "names no place", which is what omitting it says, and what the server
 * stores as `null`.
 */
export function buildCreateBulletinPayload(draft: BulletinDraft, now: Date): CreateBulletinRequest {
  const loc = draft.loc.trim();
  const expiresAt = expiresAtFor(draft.expiry, now);

  return {
    type: draft.type,
    title: draft.title.trim(),
    body: draft.body.trim(),
    ...(loc.length === 0 ? {} : { loc }),
    ...(expiresAt === undefined ? {} : { expiresAt }),
  };
}

function issueFor(value: string, maxLength: number, required: boolean): DraftFieldIssue | null {
  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return required ? 'empty' : null;
  }

  return trimmed.length > maxLength ? 'too-long' : null;
}
