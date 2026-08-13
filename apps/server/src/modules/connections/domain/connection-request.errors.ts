import { ApplicationError } from '../../../shared/errors/application-error';

/**
 * There is no connection request here for this owner to decide.
 *
 * **One answer for every refusal on the decide path** (ADR-0002 §10, ADR-0018 D5). It
 * covers: no such request, a request addressed to somebody else, one already accepted, one
 * already declined, and one that has lapsed past
 * {@link import('./connection-request.policy').CONNECTION_REQUEST_TTL_DAYS}.
 *
 * ⚠ Its own class rather than a second meaning for
 * {@link import('./personal-link.errors').PersonalLinkUnavailableError}, and the split is
 * by *reader* rather than by cause. The link refusal is answered to a stranger holding a
 * URL, where every distinction is a disclosure about the owner. This one is answered to
 * the owner about their own inbox, where the only fact available is "that row is not
 * yours to decide any more" — which they can already see by re-reading the inbox. Two
 * families, each uniform inside itself; one class covering both would have to be worded
 * for the stranger, and would tell the owner nothing at all.
 *
 * ⚠ The message must never grow a detail. "Already accepted", "that expired", or an
 * echoed requester handle would each turn this into an oracle for a request the caller may
 * not read — and "that expired" is the one most likely to be added as a kindness, which is
 * why it is named here.
 */
export class ConnectionRequestUnavailableError extends ApplicationError {
  static readonly code = 'CONNECTION_REQUEST_UNAVAILABLE';

  constructor() {
    super(
      ConnectionRequestUnavailableError.code,
      'That request is no longer available.',
    );
    this.name = 'ConnectionRequestUnavailableError';
  }
}
