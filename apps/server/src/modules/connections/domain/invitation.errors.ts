import { ApplicationError } from '../../../shared/errors/application-error';

/**
 * The one thing a caller is told about a token that will not open.
 *
 * ADR-0005's conflict matrix names this code for "invitation withdrawn/expired/
 * revoked", and M2-AC17 requires it for a spent token too. **No such token, spent
 * token, and revoked token all say exactly this**, byte for byte: an invite token is a
 * bearer credential, so a refusal that distinguished "wrong token" from "used token"
 * would let anyone holding a guessed string learn whether it had ever existed
 * (ADR-0002 §10, the same reason the auth boundary answers "no token" and "bad token"
 * identically).
 */
export class InvitationUnavailableError extends ApplicationError {
  static readonly code = 'INVITATION_UNAVAILABLE';

  constructor() {
    super(
      InvitationUnavailableError.code,
      'That invite is no longer available. Ask for a new one.',
    );
    this.name = 'InvitationUnavailableError';
  }
}

/**
 * The inviter tried to accept their own invite (M2-AC18).
 *
 * Distinct from {@link InvitationUnavailableError}, and safely so: the caller already
 * knows they created this invite, so naming the reason discloses nothing they did not
 * bring with them. The alternative — one connection whose two sides are the same
 * person — is a row every later query would have to special-case.
 */
export class CannotAcceptOwnInviteError extends ApplicationError {
  static readonly code = 'CANNOT_ACCEPT_OWN_INVITE';

  constructor() {
    super(CannotAcceptOwnInviteError.code, 'You cannot accept your own invite.');
    this.name = 'CannotAcceptOwnInviteError';
  }
}
