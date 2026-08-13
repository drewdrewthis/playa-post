Feature: Board — default listing and restricted query grammar
  As an eligible viewer
  I want to see only bulletins I am authorized to see, filtered by a restricted grammar
  So that no unauthorized bulletin or person is ever exposed through the board

  # M2 scope: default board list + ADR-0007 grammar restricted to type: and bare text.
  # Cut to M5: full grammar, sorts. (Saved views were cut entirely by #208, ADR-0019.)

  @e2e
  # @ac:M2-AC1
  # Addendum §21 critical-flow matrix item: "Bulletin visibility"
  Scenario: An eligible viewer sees a Request bulletin on their board
    Given user A creates a Request bulletin
    And user B is an eligible viewer of user A's bulletins
    When user B requests their board
    Then user B's board contains user A's bulletin

  @integration
  # @ac:M2-AC5
  Scenario: A viewer with no relationship to the author gets zero board rows
    Given user A creates a Request bulletin
    And user C has no relationship to user A
    When user C requests their board
    Then user C's board contains zero rows referencing user A's bulletin
    And fetching that bulletin by ID returns HTTP 404

  @e2e
  # @ac:M2-AC5
  # Addendum §21 critical-flow matrix item: "Hidden identities"
  Scenario: A bulletin from an author below full disclosure hides the author's identity
    Given user A's disclosure level toward user B is below full
    And user A creates a Request bulletin visible to user B
    When user B requests their board
    Then the bulletin's author renders with no name, handle, or avatar

  @integration
  # @ac:M2-AC14
  Scenario: Unauthorized and non-existent bulletin IDs are indistinguishable
    Given a bulletin ID the viewer is not authorized to see
    And a UUID that has never existed
    When the viewer fetches each bulletin by ID
    Then both responses have identical status codes and byte-identical bodies

  @unit
  # @ac:M2-AC13
  Scenario: Query grammar rejects type:note
    Given the board query grammar compiler
    When the query "type:note" is parsed
    Then it is rejected with a structured error naming the token

  @unit
  # @ac:M2-AC13
  Scenario: Query grammar rejects an unknown field instead of ignoring it
    Given the board query grammar compiler
    When the query "foo:bar" is parsed
    Then it is rejected with a structured error naming the field

  @unit
  # @ac:M2-AC13
  Scenario: Query grammar enforces the 256-character length boundary
    Given a query string of exactly 256 characters
    And a query string of exactly 257 characters
    When each is parsed
    Then the 256-character query is accepted
    And the 257-character query is rejected

  @unit
  # @ac:M2-AC13
  Scenario: Query grammar enforces the 16-term boundary
    Given a query with exactly 16 terms
    And a query with exactly 17 terms
    When each is parsed
    Then the 16-term query is accepted
    And the 17-term query is rejected
