import type { IntroPerson } from '../application/intro-person';
import {
  INTRO_INBOX_ROLE,
  type IntroInboxRole,
  type VisibleIntroInboxRow,
  type VisibleIntroOutboxRow,
} from '../application/visible-intro';
import { INTRO_REQUEST_STATUS, type IntroRequestStatus } from '../domain/intro-request';

/**
 * The four columns every person card arrives in, whichever read produced it.
 *
 * Hand-written rather than derived from `@playa-post/database`'s generated types, which
 * is the exception this file has to justify: `pnpm db:types` describes tables and views,
 * not a set-returning function's result nor an ad-hoc projection. Each read's `select`
 * list in `postgres-intro-request.repository.ts` is the contract, and the integration
 * suites are what pin it.
 *
 * `null` in all four means "there is no person to describe" — the LEFT JOIN found nobody
 * in the reader's authorized set. `null` in the last two alone means "there is a person
 * and you may not be told their name", which is the ordinary §6a absence.
 */
export interface IntroPersonColumns {
  readonly user_id: string | null;
  readonly disclosure: string | null;
  readonly display_name: string | null;
  readonly handle: string | null;
}

/** One row of `app.intro_via_candidates`. Never nullable: the function joins, not LEFT-joins. */
export interface IntroViaCandidateRow {
  readonly via_id: string;
  readonly disclosure: string;
  readonly display_name: string | null;
  readonly handle: string | null;
}

/** One row of the dual-role inbox read. */
export interface IntroInboxRow {
  readonly intro_request_id: string;
  readonly inbox_role: string;
  readonly note: string;
  readonly created_at: Date;
  readonly requester_user_id: string | null;
  readonly requester_disclosure: string | null;
  readonly requester_display_name: string | null;
  readonly requester_handle: string | null;
  /** Always `null` on a `target` row: the target is the reader. */
  readonly target_user_id: string | null;
  readonly target_disclosure: string | null;
  readonly target_display_name: string | null;
  readonly target_handle: string | null;
}

/** One row of the requester's own outbox read. */
export interface IntroOutboxRow {
  readonly intro_request_id: string;
  readonly status: string;
  readonly target_id: string;
  readonly created_at: Date;
  readonly decided_at: Date | null;
  readonly via_user_id: string | null;
  readonly via_disclosure: string | null;
  readonly via_display_name: string | null;
  readonly via_handle: string | null;
}

/**
 * Assemble a person card, or decline to.
 *
 * ⚠ The card is **whole or absent**, never partially assembled. `user_id` and
 * `disclosure` come from the same joined row, so in practice they are null together;
 * requiring both is what lets the compiler see that, and it is the right failure
 * direction anyway — a row that somehow carried one without the other describes a person
 * the projection could not produce, and the answer to that is no card rather than a card
 * with a hole in it.
 *
 * ⚠ The identity fields are **omitted, not set to `null`**. A `null` says "there is a
 * name and you are not getting it"; an absent key says "there is no name here", which is
 * the shape ADR-0002 §6a's `topology_only` person actually has and the one
 * `exactOptionalPropertyTypes` lets the compiler keep honest. It is also what makes
 * `JSON.stringify` of a below-`full` card carry no identity keys at all.
 */
export function toIntroPerson(columns: IntroPersonColumns): IntroPerson | undefined {
  if (columns.user_id === null || columns.disclosure === null) {
    return undefined;
  }

  return {
    userId: columns.user_id,
    disclosure: columns.disclosure,
    ...(columns.display_name === null ? {} : { displayName: columns.display_name }),
    ...(columns.handle === null ? {} : { handle: columns.handle }),
  };
}

/** Translate one candidate row into the shared person card. */
export function toIntroViaCandidate(row: IntroViaCandidateRow): IntroPerson {
  return {
    userId: row.via_id,
    disclosure: row.disclosure,
    ...(row.display_name === null ? {} : { displayName: row.display_name }),
    ...(row.handle === null ? {} : { handle: row.handle }),
  };
}

/**
 * Narrow the role the statement computed.
 *
 * The value is written by the read's own `select` list — a caller cannot supply it — so
 * an unrecognised one is this file and that statement having drifted apart, which is a
 * programming mistake rather than a refusal.
 */
function toIntroInboxRole(stored: string): IntroInboxRole {
  const known = Object.values(INTRO_INBOX_ROLE).find((role) => role === stored);

  if (known === undefined) {
    throw new Error('toIntroInboxRole: the inbox read produced an unknown role');
  }

  return known;
}

/** Narrow a stored status — see `intro-request.mapper.ts` for why this throws. */
function toIntroRequestStatus(stored: string): IntroRequestStatus {
  const known = Object.values(INTRO_REQUEST_STATUS).find((status) => status === stored);

  if (known === undefined) {
    throw new Error('toIntroRequestStatus: app.intro_requests.status holds an unknown value');
  }

  return known;
}

/**
 * Translate one projected row into the {@link VisibleIntroInboxRow} read model.
 *
 * Both cards are omitted rather than nulled when absent, so a serialized row from a
 * reader who may not be told who a party is carries no `requester`/`target` key at all
 * and there is nothing for a client to render a placeholder into.
 */
export function toVisibleIntroInboxRow(row: IntroInboxRow): VisibleIntroInboxRow {
  const requester = toIntroPerson({
    user_id: row.requester_user_id,
    disclosure: row.requester_disclosure,
    display_name: row.requester_display_name,
    handle: row.requester_handle,
  });
  const target = toIntroPerson({
    user_id: row.target_user_id,
    disclosure: row.target_disclosure,
    display_name: row.target_display_name,
    handle: row.target_handle,
  });

  return {
    id: row.intro_request_id,
    role: toIntroInboxRole(row.inbox_role),
    note: row.note,
    createdAt: row.created_at,
    ...(requester === undefined ? {} : { requester }),
    ...(target === undefined ? {} : { target }),
  };
}

/** Translate one projected row into the {@link VisibleIntroOutboxRow} read model. */
export function toVisibleIntroOutboxRow(row: IntroOutboxRow): VisibleIntroOutboxRow {
  const via = toIntroPerson({
    user_id: row.via_user_id,
    disclosure: row.via_disclosure,
    display_name: row.via_display_name,
    handle: row.via_handle,
  });

  return {
    id: row.intro_request_id,
    status: toIntroRequestStatus(row.status),
    targetId: row.target_id,
    createdAt: row.created_at,
    ...(row.decided_at === null ? {} : { decidedAt: row.decided_at }),
    ...(via === undefined ? {} : { via }),
  };
}
