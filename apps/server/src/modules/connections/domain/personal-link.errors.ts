import { ApplicationError } from '../../../shared/errors/application-error';

/**
 * There is no personal link here for this caller to open or to ask through.
 *
 * **One answer for every refusal on the link path**, and the uniformity *is* the security
 * property (ADR-0002 §10, B17, ADR-0018 D3). It covers: no such slug, a slug the owner has
 * rotated away from, an owner who is deactivated or erased, a caller asking through their
 * own link, a pair who are already connected, a request the pair already has open, an
 * owner whose pending inbox is at
 * {@link import('./connection-request.policy').PENDING_CONNECTION_REQUEST_CAP}, and a link
 * that has produced
 * {@link import('./connection-request.policy').CONNECTION_REQUEST_RATE_LIMIT} requests
 * inside its window.
 *
 * ⚠ **The rotated case is the whole point.** A distinct "that link was retired" would tell
 * whoever kept the old URL that it *was* real and that its owner deliberately shed it —
 * which is precisely what somebody rotating away from a stranger must not broadcast.
 * Serializing every response above into a `Set` must yield exactly one element.
 *
 * ⚠ **The two limits are folded in here rather than given their own honest codes**, and
 * that costs a requester a clearer message on purpose. "Not accepting requests right now"
 * is a statement about the owner's inbox — how full it is, how much traffic their link is
 * getting — and a link is a URL anybody may hold. One refusal keeps the owner's activity
 * unreadable from outside; the client's copy therefore says only that the link is not
 * available, and must never grow a "try again later" branch, because that branch *is* the
 * disclosure.
 *
 * It is one class with one message for the reason
 * {@link import('./invitation.errors').InvitationUnavailableError} is: making the cases
 * indistinguishable *by construction* beats keeping several messages worded identically,
 * which is a property that holds until somebody improves one of them.
 */
export class PersonalLinkUnavailableError extends ApplicationError {
  static readonly code = 'PERSONAL_LINK_UNAVAILABLE';

  constructor() {
    super(PersonalLinkUnavailableError.code, 'That link is not available.');
    this.name = 'PersonalLinkUnavailableError';
  }
}
