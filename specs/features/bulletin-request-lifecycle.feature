Feature: Bulletin lifecycle — Request creation, archival, and atomicity
  As a user
  I want to create a Request bulletin and later archive it
  So that my board reflects only what I intend to still be visible

  # M2 scope: Request type only — create, read via authorized board query, archive;
  # lifecycle timestamps + version. Cut to M5: the other six types, edit, expiry sweep,
  # tags, location, URL detection.

  @e2e
  # @ac:M2-AC1
  Scenario: A user creates a Request bulletin and later archives it
    Given an onboarded user
    When they create a Request bulletin
    And they later archive that bulletin
    Then the bulletin's archivedAt timestamp is set

  @integration
  # @ac:M2-AC6
  Scenario: A fault after insert and before commit leaves no partial state
    Given a fault is injected after the bulletin insert and before the transaction commits
    When bulletin.create is submitted
    Then the bulletins table contains zero new rows
    And the outbox_events table contains zero new rows

  @integration
  # @ac:M2-AC12
  Scenario: Archived bulletin is gone for non-authors but retained for the author
    Given the author has archived their bulletin
    When a non-author fetches the bulletin by ID
    Then the response is HTTP 404 with code BULLETIN_GONE
    And the author's own bulletin list still contains it with archivedAt set

  @integration
  # @ac:M2-AC12
  Scenario: Archiving an already-archived bulletin is idempotent
    Given a bulletin the author has already archived
    When the author archives it a second time
    Then the response is HTTP 200
    And archivedAt is unchanged from the first archive call

  @integration
  # @ac:M2-AC18
  Scenario: Archiving another user's bulletin is rejected
    Given a bulletin authored by user A
    When user B attempts to archive it
    Then the response is a structured error with a stable code

  @integration
  # @ac:M2-AC19
  Scenario: bulletin.create and bulletin.archive fail closed for an unrelated actor
    Given a bulletin authored by user A
    And an actor C with no relationship to that bulletin
    When actor C submits bulletin.archive for it
    Then the response is a structured error
    And zero rows change on the bulletins table
    And zero rows are written to outbox_events
