Feature: Directional trust — private, per-connection trust assignment
  As a user with an accepted connection
  I want to set a private trust value for that connection
  So that only I can see how much I trust them

  # M2 scope: SetConnectionTrust (private, directional, unset ≠ 0).
  # expectedVersion / conflict handling for trust.set is cut to M5 (ADR-0005 full matrix).

  @e2e
  # @ac:M2-AC1
  # Addendum §21 critical-flow matrix item: "Directional trust changes"
  Scenario: A user assigns private directional trust to an accepted connection
    Given user A and user B have an accepted connection
    When user A sets trust 85 on the connection to user B
    Then user A's own read of the connection shows trust 85

  @integration
  # @ac:M2-AC3
  Scenario: Trust value is never present in a payload reachable by the other party
    Given user A has set trust 85 on the connection to user B
    When user B reads the graph, the board, the person sheet, and the sync response
    Then none of those payloads contain the value 85 or a trust field
    And an error or conflict envelope for that connection also contains no trust field

  @integration
  # @ac:M2-AC3
  Scenario: Trust value is never present in a payload reachable by a third party
    Given user A has set trust 85 on the connection to user B
    When an unrelated third party requests any surface referencing that connection
    Then no trust value or trust field is present in the response

  @integration
  # @ac:M2-AC4
  Scenario: A connection with no trust assigned serializes as null, not zero
    Given user A and user B have an accepted connection with no trust ever set
    When user A reads the connection
    Then the trust field serializes as null
    And the underlying column value is NULL, not 0

  @integration
  # @ac:M2-AC4
  Scenario: A deliberately-set trust of zero serializes as zero, not null
    Given user A has explicitly set trust 0 on the connection to user B
    When user A reads the connection
    Then the trust field serializes as 0
    And the underlying column value is 0, not NULL

  @integration
  # @ac:M2-AC18
  Scenario: Setting trust on a non-connection is rejected
    Given user A and user C have no connection
    When user A attempts to set trust on user C
    Then the response is a structured error with a stable code

  @integration
  # @ac:M2-AC19
  Scenario: trust.set from an actor unrelated to the connection fails closed
    Given a connection between user A and user B
    And an actor C who is not party to that connection
    When actor C submits trust.set for that connection
    Then the response is a structured error
    And zero rows change on the connection's trust column
    And zero rows are written to outbox_events
