Feature: Pin a note — the private channel between two people who are already connected
  As someone who knows a person on the playa
  I want to leave a note only they can read, on their board
  So that a thing meant for one person does not have to be said to everybody

  # Issue #88, decision D6. The owner directive reopens what decision D2 cut, and the
  # PDF's constraint is honoured structurally rather than by naming: PDF §6 forbids
  # silently mixing fixed-recipient messaging into the bulletin model, so a note is its
  # own table (`app.notes`), its own authorized set (`app.visible_notes`), and its own
  # module — never a seventh bulletin type. `bulletins.create` still refuses the value
  # `note`, which `bulletin-post-types.feature` asserts and this feature does not change.
  #
  # Degree 1 is the whole gate, and it is enforced *inside the insert statement* rather
  # than by a check before it, so a refusal leaves no row and no event. The "WHO CAN PIN
  # TO YOUR BOARD" control from the comp is deliberately absent — see D6 for why its
  # semantics are an open owner question.
  #
  # Two absences below are deliberate and would otherwise read as gaps:
  #
  # The person sheet's "Pin a note" entry point is NOT in this feature. Composing from a
  # person — rather than from a bulletin's detail sheet — belongs to issue #85's person
  # sheet, and is left to it rather than half-built here so there is one decision about
  # where that surface lives instead of two.
  #
  # There is no scenario for the author reading a note back, because there is nothing to
  # read: notes are recipient-only (D6), `app.visible_notes` gates on
  # `recipient_id = viewer_id`, and `notes.list` takes no argument. The author sees no
  # trace of what they sent — no sent list, no receipt, no read state. "A note is left on
  # somebody else's board" is the whole model, and the first scenario asserts the author's
  # own list is empty as the positive statement of it.
  #
  # No @e2e scenario. The browser surface exists (compose sheet, board card, the detail
  # sheet's degree-gated control) but a Playwright walk of it needs two *connected*
  # users, and `tests/e2e/global-setup.ts` onboards two who are not — connecting them is
  # the vertical-slice spec's own multi-step flow. The web behaviour below is proved at
  # `@unit` instead, which is where it lives: `apps/web`'s unit project runs in
  # `environment: 'node'` with no component harness, so every decision this feature makes
  # is in a pure module beside the component that renders it.
  #
  # The `@integration` scenarios are in
  # `modules/notes/tests/integration/pin-a-note.integration.test.ts`.

  @integration
  # @issue:88
  Scenario: A note reaches its recipient's board and nobody else's
    Given user A and user B are directly connected
    And user C is connected to user B but not to user A
    When user A pins a note to user B
    Then user B's note list carries it, with user A as its author
    And user A's own note list is empty
    And user C's note list is empty

  @integration
  # @issue:88
  Scenario: An author who discloses only limited appears on the note with no name
    Given user A and user B are directly connected
    And user A discloses only "limited" to user B
    When user A pins a note to user B
    Then user B's note list carries it
    And the note's author carries no display name and no handle

  @integration
  # @issue:88
  Scenario: Pinning to a second-degree person is refused and writes nothing
    Given user A and user B are directly connected
    And user B and user C are directly connected
    And user A and user C are not directly connected
    When user A attempts to pin a note to user C
    Then the attempt is refused as NOTE_RECIPIENT_UNREACHABLE
    And no note row is written
    And no outbox event is written

  @integration
  # @issue:88
  Scenario: Pinning to a stranger is refused the same way as pinning to nobody
    Given user A has no connection to user D
    When user A attempts to pin a note to user D
    And user A attempts to pin a note to a user ID that names nobody
    And user A attempts to pin a note to themselves
    Then all three attempts are refused identically, disclosing nothing about who exists
    And no note row is written

  @integration
  # @issue:88
  Scenario: An empty or over-long note is refused naming the body
    Given user A and user B are directly connected
    When user A attempts to pin a note whose body is only whitespace
    And user A attempts to pin a note longer than the body bound
    Then each attempt is refused as NOTE_CONTENT_INVALID
    And no note row is written

  @integration
  # @issue:88
  Scenario: Replaying the same note.pin envelope through sync writes one note
    Given user A and user B are directly connected
    When user A submits a note.pin envelope and submits the identical envelope again
    Then the second submission is reported as replayed with the first result
    And user B's board carries exactly one note

  @integration
  # @issue:88
  Scenario: The idempotency store keeps no copy of a pinned note's text
    Given user A and user B are directly connected
    When user A submits a note.pin envelope whose body is a distinctive phrase
    Then the stored idempotency result carries no body field
    And the stored result does not contain the note's text anywhere

  @integration
  # @issue:88
  Scenario: The outbox event for a pinned note carries identifiers only
    Given user A and user B are directly connected
    When user A pins a note whose body is a distinctive phrase
    Then one NotePinned event is written carrying the note, author and recipient IDs
    And the serialized event payload does not contain the note's text

  @integration
  # @issue:88
  Scenario: A delivered note outlives the connection that carried it
    Given user A and user B are directly connected
    And user A has pinned a note to user B
    When the connection between user A and user B is severed
    Then user B's note list still carries the note
    And the note carries no author card at all
    And user A's identifier appears nowhere in it

  @integration
  # @issue:88
  Scenario: A delivered note outlives its author deactivating
    Given user A and user B are directly connected
    And user A has pinned a note to user B
    When user A's account is deactivated
    Then user B's note list still carries the note
    And the note carries no author card at all
    And user A's identifier appears nowhere in it

  @integration
  # @issue:88
  Scenario: An author who lowers their disclosure after pinning keeps the note and loses the name
    Given user A and user B are directly connected at "full" disclosure
    And user A has pinned a note to user B, which carries user A's name
    When user A lowers their disclosure to user B to "limited"
    Then user B's note list still carries the note
    And its author card carries the user ID and disclosure only
    And the card carries no display name and no handle

  @unit
  # @issue:88
  Scenario: The note body is trimmed, bounded, and never empty
    Given a submitted note body
    When the content policy validates it
    Then a whitespace-only body is refused
    And a body longer than the bound is refused
    And an accepted body is returned trimmed

  @unit
  # @issue:88
  Scenario: The compose form refuses an empty or over-long note before the round trip
    Given a note draft in the compose sheet
    When the draft is inspected against the server's bound
    Then a whitespace-only draft is not pinnable
    And a draft past the bound is not pinnable, measured after trimming
    And the queued payload carries only a recipient and a trimmed body

  @unit
  # @issue:88
  Scenario: A recipient whose name §6a withheld is addressed without one being invented
    Given a person the viewer may see but whose name was not disclosed
    When the compose sheet writes its title, privacy line, button, and toast
    Then each names "their board" rather than a placeholder
    And no sentence contains a rendered null or a dangling possessive

  @unit
  # @issue:88
  Scenario: The pin control is offered only to a direct connection
    Given a bulletin author on the viewer's own graph
    When the detail sheet decides what to offer
    Then a first-degree author gets the pin control
    And an author further away gets the intro hint naming the degree already visible
    And an author absent from the graph gets the requirement, naming no degree

  @unit
  # @issue:88
  Scenario: Notes join the board by time and are never returned by a search
    Given the viewer's bulletins and the notes pinned to their board
    When the board composes its rows
    Then the two kinds are interleaved newest first, each keyed apart from the other
    And no note appears at all while a query is active

  @unit
  # @issue:88
  Scenario: A refused pin keeps the note on screen and discloses nothing about the recipient
    Given a queued note the server refused
    When the settled queue row is read back
    Then an unreachable recipient is answered with the requirement, not with a fact about them
    And a failed or conflicted row is never rendered as a success
    And a code this build has no copy for is shown as itself

  @unit
  # @issue:88
  Scenario: A queued note replays through the path that deduplicates it
    Given the client's queued mutation types and the drainer's replay routes
    When the two are compared
    Then every queued type has exactly one route
    And note.pin is routed through sync.submitMutations rather than replayed directly
