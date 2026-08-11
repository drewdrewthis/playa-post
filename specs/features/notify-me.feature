Feature: Notify Me — saved-query notifications
  As a user with Notify Me switched on
  I want to be notified, grouped and privacy-safe, when a matching bulletin appears
  So that I learn about relevant bulletins without leaking their content off-device

  # M2 scope: Web Push subscribe; EvaluateNotifyMeHandler on BulletinCreated; one grouped
  # push via a 60s window; delivery-time authorization re-check + identifier-only payloads
  # (ADR-0002 §11).
  # Cut to M5: grouping across event families, cross-device dedup, subscription expiry,
  # preferences, the query-change combined notification.
  #
  # ⚠ **This file said "single saved-query" until issue #172.** Decision D1 read the PDF's
  # one Notify Me query against the comp's bell-on-every-card and kept the PDF's count;
  # **decision D16 reopens it** at the owner's direction — several bells may be lit at
  # once, bounded per person because the evaluator reads every switched-on query against
  # every new bulletin. A brief that reads only D1 will build the wrong thing.

  @e2e
  # @ac:M2-AC1
  # Addendum §21 critical-flow matrix item: "Notify Me matching"
  Scenario: A matching Request bulletin produces a grouped push notification
    Given a viewer with a Notify Me query and a push subscription
    And a Request bulletin is created that matches that query
    When the notification window flushes
    Then exactly one push notification is delivered to the viewer
    And a matching row exists in consumer_receipts

  @integration
  # @ac:M2-AC7
  Scenario: A second matching bulletin at 59 seconds joins the same group
    Given a matching bulletin opened the notification window at t = 0
    When a second matching bulletin is created at t = 59 seconds
    Then both bulletins are delivered as one notification

  @integration
  # @ac:M2-AC7
  Scenario: A matching bulletin at 61 seconds starts a new group
    Given a matching bulletin opened the notification window at t = 0
    When a second matching bulletin is created at t = 61 seconds
    Then a second, separate notification is produced

  @e2e
  # @ac:M2-AC8
  # Addendum §21 critical-flow matrix item: "Event idempotency"
  Scenario: Delivering the same event twice produces one notification
    Given a BulletinCreated event has already been delivered once
    When the same event is delivered again
    Then exactly one notification row exists
    And exactly one consumer_receipts row exists

  @integration
  # @ac:M2-AC21
  Scenario: Push payload carries only identifiers and a generic string
    Given a matching bulletin triggers a push
    When the push payload is captured
    Then it contains only identifiers and a generic string
    And it contains no headline, body, author name, or contact data

  @integration
  # @ac:M2-AC22
  Scenario: A recipient made unauthorized before flush does not receive the push
    Given a push has been computed for a recipient
    And that recipient's authorization is revoked before the scheduled flush
    When the flush runs
    Then no push is sent to that recipient
    And the receipt records the suppression

  @integration
  # @ac:M2-AC23
  Scenario: A throwing consumer is retried with growing backoff and eventually dead-lettered
    Given a consumer handler that always throws
    When the event is retried across 8 attempts
    Then available_at grows per least(15 min, 5s * attempts^2) on each attempt
    And after the 8th attempt the event's status is dead
    And no further attempt occurs

  @integration
  # @ac:M2-AC24
  Scenario: Two concurrent drainers claim disjoint events
    Given a seeded backlog of pending outbox events
    When two drainer instances claim events concurrently
    Then the two instances' claimed event ID sets have an empty intersection
    And each claimed event receives exactly one receipt

  @integration
  # @ac:M2-AC18
  # A repeat rather than a refusal, the same shape connections.feature gives "Accepting
  # an already-accepted invite is idempotent": one row per owner is still the M2 model,
  # and what the second submit is answered with is a legible success. Enrolling has to
  # be repeatable — a device whose stored endpoint has died is pointed at a live one by
  # pressing "Enable push" again, and nothing else in M2 can do it.
  Scenario: Re-subscribing to push replaces the stored subscription
    Given a viewer who already has an active push subscription
    When that viewer submits a different push subscription
    Then that viewer has exactly one stored push subscription
    And it is the one most recently submitted

  @integration
  # @ac:M2-AC19
  Scenario: notifyMe.update fails closed for an actor unrelated to the query
    Given a Notify Me query belonging to user A
    And an actor C with no relationship to user A's query
    When actor C submits notifyMe.update for that query
    Then the response is a structured error
    And zero rows change on the Notify Me query
    And zero rows are written to outbox_events

  @integration
  # @ac:172-AC1
  # Decision D16, reopening D1. Under D1 the second bell put the first one out; the
  # assertion is on the stored queries rather than on the answer, because a bell that
  # "lit" by overwriting its neighbour looks identical from the outside.
  Scenario: A second saved view can be notified on without switching the first off
    Given a viewer with Notify Me switched on for a saved view
    When that viewer switches Notify Me on for a second saved view
    Then both saved views are notifying
    And each notifying view carries its own saved query

  @integration
  # @ac:172-AC2
  Scenario: Switching one saved view's notifications off leaves the others on
    Given a viewer with Notify Me switched on for three saved views
    When that viewer switches Notify Me off for one of them
    Then the other two are still notifying
    And exactly one notification is announced as cleared

  @integration
  # @ac:172-AC4
  # The bound D1's primary key used to provide: the evaluator reads every switched-on
  # query on every BulletinCreated, so the count per person has to stop somewhere.
  Scenario: Switching on more notifications than the per-person cap is refused
    Given a viewer already at the Notify Me cap
    When that viewer switches Notify Me on for one more saved view
    Then the response is a structured error naming the cap
    And the views that were notifying are still notifying

  @integration
  # @ac:172-AC1
  # The corollary that makes several bells safe: notifications are per person, not per
  # query. Without it a person is pushed the same bulletin once per bell they lit.
  Scenario: A bulletin matching two of one viewer's queries notifies them once
    Given a viewer with Notify Me switched on for two saved views
    And a bulletin is created that matches both of their queries
    When the notification window flushes
    Then exactly one notification is delivered to that viewer

  @integration
  # @ac:172-AC3
  Scenario: An existing single-notify user keeps their notification through the migration
    Given a stored Notify Me query from before multiple notifications were allowed
    When the migration that allows several is applied
    Then that query still exists, designated from the same saved view
    And that viewer can switch a second one on with no further migration
