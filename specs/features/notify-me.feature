Feature: Notify Me — single saved-query notification
  As a user with a Notify Me query
  I want to be notified, grouped and privacy-safe, when a matching bulletin appears
  So that I learn about relevant bulletins without leaking their content off-device

  # M2 scope: one Notify Me query (D1); Web Push subscribe; EvaluateNotifyMeHandler on
  # BulletinCreated; one grouped push via a 60s window; delivery-time authorization
  # re-check + identifier-only payloads (ADR-0002 §11).
  # Cut to M5: grouping across event families, cross-device dedup, subscription expiry,
  # preferences, the query-change combined notification.

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
  Scenario: Subscribing to push twice is rejected
    Given a viewer who already has an active push subscription
    When that viewer submits another push subscription request
    Then the response is a structured error with a stable code

  @integration
  # @ac:M2-AC19
  Scenario: notifyMe.update fails closed for an actor unrelated to the query
    Given a Notify Me query belonging to user A
    And an actor C with no relationship to user A's query
    When actor C submits notifyMe.update for that query
    Then the response is a structured error
    And zero rows change on the Notify Me query
    And zero rows are written to outbox_events
