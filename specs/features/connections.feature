Feature: Connections — invite acceptance
  As an invited user
  I want to accept an invite
  So that an accepted connection exists between me and the inviter

  # M2 scope: accept; SetConnectionTrust lives in directional-trust.feature.
  # Cut to M5: connection removal, introduction requests, blocking.

  @e2e
  # @ac:M2-AC1
  # Addendum §21 critical-flow matrix item: "Invite and connection acceptance"
  Scenario: Two users complete invite creation, opening, and acceptance
    Given user A creates an invite
    And user B opens user A's invite
    When user B accepts the invite
    Then an accepted connection exists between user A and user B

  @integration
  # @ac:M2-AC18
  Scenario: Accepting your own invite is rejected
    Given user A has created an invite
    When user A attempts to accept their own invite
    Then the response is a structured error with a stable code

  @integration
  # @ac:M2-AC18
  Scenario: Accepting an already-accepted invite is idempotent
    Given user B has already accepted user A's invite
    When user B submits the acceptance again
    Then the response is HTTP 200
    And no second connection is created

  @integration
  # @ac:M2-AC19
  Scenario: connection.accept from an unrelated actor fails closed
    Given an invite created by user A
    And an actor C with no relationship to that invite
    When actor C submits connection.accept for that invite
    Then the response is a structured error
    And zero rows change on the connections table
    And zero rows are written to outbox_events

  @integration
  # @ac:M2-AC17
  # ADR-0005 conflict rule: "Invitation withdrawn/expired/revoked → rejected / INVITATION_UNAVAILABLE"
  Scenario: Accepting a withdrawn invitation is refused
    Given an invite that user A has withdrawn
    When user B attempts to accept it
    Then the response is a structured error with code INVITATION_UNAVAILABLE
