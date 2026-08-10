/** `connections.invitations.create` output. The token is the whole invite. */
export interface Invite {
  readonly token: string;
}

/** Input of every procedure that spends or previews an invite token. */
export interface InviteTokenRequest {
  readonly token: string;
}

/** `connections.invitations.open` output — who the token would connect you to. */
export interface OpenedInvite {
  readonly inviterId: string;
}

/** `connections.connection.get` input. */
export interface GetConnectionRequest {
  readonly otherUserId: string;
}

/**
 * A connection as the **viewer** sees it.
 *
 * `trust` is the viewer's own directional value and reaches nobody else: for a
 * connection the viewer does not hold, the server *refuses* with a `NOT_FOUND`
 * carrying `NOT_CONNECTED` — this procedure never resolves for a stranger, so absence
 * is an error envelope, not a null payload (B6). Within a resolved connection, `null`
 * trust is *unset*, `0` is a deliberate zero — two states, and a client that collapses
 * them into one falsy branch has lost a user's explicit choice.
 */
export interface Connection {
  readonly status: string;
  readonly trust: number | null;
}

/** `connections.trust.set` input. */
export interface SetTrustRequest {
  readonly subjectUserId: string;
  readonly trust: number;
}
