Feature: Offline sync — mutation envelope replay and idempotency
  As a user who was offline
  I want my queued mutation to sync exactly once when I reconnect
  So that flaky connectivity never duplicates or loses my change

  # M2 scope: envelope + mutation_results + replay for exactly bulletin.create; the
  # actorship precedence rule for every M2 mutation, whether via tRPC or via
  # sync.submitMutations. Cut to M5: full conflict matrix, expired, batching,
  # expectedVersion paths, conflict UI.

  @e2e
  # @ac:M2-AC9
  # Addendum §21 critical-flow matrix item: "Offline mutation replay"
  Scenario: The same bulletin.create envelope submitted twice produces one bulletin
    Given a bulletin.create envelope with a client-generated mutationId
    When that envelope is submitted once
    And the identical envelope is submitted again
    Then exactly one bulletin exists
    And the first response outcome is applied
    And the second response outcome is replayed with an identical result

  @integration
  # @ac:M2-AC9
  Scenario: Same mutationId with a different payload is rejected
    Given a bulletin.create envelope with mutationId M has already been applied
    When a different payload is submitted with the same mutationId M
    Then the response outcome is rejected with code IDEMPOTENCY_KEY_REUSE
    And no second bulletin is created

  @integration
  # @ac:M2-AC19
  Scenario: Actorship is checked before version comparison over the sync envelope
    Given a bulletin authored by user A
    And an actor C with no relationship to that bulletin
    When actor C submits a bulletin.archive envelope for it via sync.submitMutations
    Then the response outcome is rejected
    And no conflict envelope is returned
    And zero rows change on the bulletins table
    And zero rows are written to outbox_events
