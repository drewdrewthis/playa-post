import type { ConnectionPerson } from '../application/connection-person';
import type { OpenedPersonalLinkFacts } from '../application/opened-personal-link';
import type { VisibleConnectionRequest } from '../application/visible-connection-request';

/**
 * One inbox row as its statement selects it.
 *
 * Hand-declared rather than derived from the generated schema, because it is the shape of a
 * *join* — `app.connection_requests` joined onto `app.visible_people`'s projection — and no
 * table describes it. The identity columns are nullable because the function projects them
 * only at `full` disclosure, even though this particular read always asks for a person's own
 * self-projection and therefore always gets `full` (see
 * {@link import('../application/visible-connection-request').VisibleConnectionRequest}). The
 * mapper still treats them as optional: a shape that assumed `full` would break silently the
 * day somebody changed which viewer the projection is computed for.
 */
export interface ConnectionRequestInboxRow {
  readonly id: string;
  readonly created_at: Date;
  readonly requester_user_id: string;
  readonly requester_disclosure: string;
  readonly requester_display_name: string | null;
  readonly requester_handle: string | null;
}

/** What the slug-resolution statement selects. */
export interface PersonalLinkFactsRow {
  readonly owner_user_id: string;
  readonly owner_disclosure: string;
  readonly owner_display_name: string | null;
  readonly owner_handle: string | null;
  readonly connected: boolean;
  readonly request_pending: boolean;
}

/**
 * Build a person card from a projected row.
 *
 * ⚠ **An absent name stays absent** — the key is omitted rather than set to `null`, so a
 * serialized card carries no `displayName` property at all and there is nothing for a client
 * to render a placeholder into. `avatarUrl` is never set: `app.users.avatar_path` is a
 * private bucket key rather than a URL and no module mints a signed one (ADR-0002 §9).
 */
function toConnectionPerson(fields: {
  readonly userId: string;
  readonly disclosure: string;
  readonly displayName: string | null;
  readonly handle: string | null;
}): ConnectionPerson {
  return {
    userId: fields.userId,
    disclosure: fields.disclosure,
    ...(fields.displayName === null ? {} : { displayName: fields.displayName }),
    ...(fields.handle === null ? {} : { handle: fields.handle }),
  };
}

/** Translate one inbox row into the read model. */
export function toVisibleConnectionRequest(
  row: ConnectionRequestInboxRow,
): VisibleConnectionRequest {
  return {
    id: row.id,
    createdAt: row.created_at,
    requester: toConnectionPerson({
      userId: row.requester_user_id,
      disclosure: row.requester_disclosure,
      displayName: row.requester_display_name,
      handle: row.requester_handle,
    }),
  };
}

/** Translate the slug-resolution row into the facts the application collapses into a state. */
export function toOpenedPersonalLinkFacts(row: PersonalLinkFactsRow): OpenedPersonalLinkFacts {
  return {
    owner: toConnectionPerson({
      userId: row.owner_user_id,
      disclosure: row.owner_disclosure,
      displayName: row.owner_display_name,
      handle: row.owner_handle,
    }),
    connected: row.connected,
    requestPending: row.request_pending,
  };
}
