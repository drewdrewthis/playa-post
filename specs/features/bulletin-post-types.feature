Feature: Bulletin post types — the six postable kinds of exchange
  As a person on the playa
  I want to post offers, events, collabs, thanks, and intro-seeking bulletins, not just requests
  So that the board carries the range of exchange the product is designed around

  # Issue #87. The postable vocabulary is the comp's compose set: offer, request,
  # event, collab, thanks, intro — six of the grammar's seven. `update` stays
  # filterable-but-not-postable (a network update is written by the system, never
  # composed — decision D5), and `note` stays refused entirely (decision D2).
  #
  # Only the first scenario is @e2e: it is the one with a browser-level Playwright
  # proof (`tests/e2e/bulletin-post-types.spec.ts`). The rest are API-level, in
  # `bulletin-post-types.integration.test.ts`.

  @e2e
  # @issue:87
  Scenario: Each of the six postable types round-trips through create and the board
    Given user A and an eligible viewer user B
    When user A creates one bulletin of each postable type
    Then each create succeeds and echoes its type
    And user B's board carries all six bulletins, each with its author's type

  @integration
  # @issue:87
  Scenario: The type: filter narrows a mixed board to the asked-for types
    Given user A has posted one bulletin of each postable type
    When user B queries their board with "type:offer|thanks"
    Then the board contains exactly the offer and the thanks bulletins

  @integration
  # @issue:87
  Scenario: Filtering for the never-postable update is an empty board, not an error
    Given user A has posted one bulletin of each postable type
    When user B queries their board with "type:update"
    Then the board is empty
    And the query is not refused

  @integration
  # @issue:87
  Scenario: The two non-postable vocabulary members are refused at create
    Given an authenticated user
    When they attempt to create a bulletin of type "update" and of type "note"
    Then each attempt is refused with a validation error naming the type field
    And no bulletin row is written
