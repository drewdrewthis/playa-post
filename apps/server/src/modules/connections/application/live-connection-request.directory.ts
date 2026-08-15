/**
 * The port onto this module's request-inbox liveness, for other modules (issue #218).
 *
 * Exists so `modules/notifications` can ask "which of the requests I notified this owner
 * about are still waiting on them?" without a second module's query against
 * `app.connection_requests` — addendum §19 routes the read through a small public
 * application interface, and this is it, the exact shape of
 * `modules/views`' `NotifyMeQueryDirectory`.
 *
 * ⚠ **Identifiers only, deliberately.** The inbox read this wraps returns requester
 * cards; none of that may leave the module through here. A notification names a request
 * and the inbox on `/graph` is where the person is met.
 */
export interface LiveConnectionRequestDirectory {
  /**
   * The ids of every request still live — pending and unlapsed — in this viewer's inbox.
   *
   * The same statement and the same TTL arithmetic as the owner's own inbox read, so a
   * notification can never outlive the row it points at: decided, lapsed, and
   * deactivated-requester rows all vanish from both surfaces at once.
   *
   * @param viewerId - The reading actor's `app.users.id`, from the resolved actor —
   *   never from request input (ADR-0002 §5a). It is the whole authorization.
   * @returns Empty for anybody nobody has asked.
   */
  listLiveRequestIdsFor(viewerId: string): Promise<readonly string[]>;
}
