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
  # No @e2e scenario: there is no browser surface for notes yet. Every scenario below is
  # API-level, in `modules/notes/tests/integration/pin-a-note.integration.test.ts`,
  # except the content-policy one, which is pure domain logic.

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
    Then both attempts are refused identically, disclosing nothing about who exists

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
  Scenario: The outbox event for a pinned note carries identifiers only
    Given user A and user B are directly connected
    When user A pins a note whose body is a distinctive phrase
    Then one NotePinned event is written carrying the note, author and recipient IDs
    And the serialized event payload does not contain the note's text

  @unit
  # @issue:88
  Scenario: The note body is trimmed, bounded, and never empty
    Given a submitted note body
    When the content policy validates it
    Then a whitespace-only body is refused
    And a body longer than the bound is refused
    And an accepted body is returned trimmed
