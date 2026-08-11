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
  # The author still cannot read a note back, and since #176 that is *asserted* rather
  # than merely unimplemented. Notes are recipient-only (D6), `app.visible_notes` gates on
  # `recipient_id = viewer_id`, and `notes.list` takes no argument — but `notes.getById`
  # does take one, so "the author has no way to fetch what they sent" became a claim that
  # needed proving instead of a procedure that did not exist. It is proved below, in the
  # same scenario as the stranger's refusal and with the same bytes. There is still no
  # sent list, no receipt, and no read state.
  #
  # Issue #176 and decision D14 added the expanded view. A note card opens, `notes.getById`
  # backs it, and the control it carries is "pin a note back" — which is a NEW note
  # addressed to the author, through this same feature's `pin` and this same degree-1
  # gate. It is not an operation on the note being read: D14 revisited the no-lifecycle
  # decision and deliberately kept it, so there is still no unpin, no archive, no edit, no
  # version and no ordering, and #176 shipped no migration.
  #
  # The @e2e scenario arrived with #176. It could not exist for #88 because a Playwright
  # walk needs two *connected* users and `tests/e2e/global-setup.ts` onboarded two who
  # were not; it now connects A—B and B—C for #89's sake, which is what unblocked this.
  # The web decisions below are still proved at `@unit`, which is where they live.
  #
  # The `@integration` scenarios are in
  # `modules/notes/tests/integration/pin-a-note.integration.test.ts` (#88) and
  # `modules/notes/tests/integration/read-a-note.integration.test.ts` (#176).

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

  # ─── The expanded view, and answering a note (issue #176, decision D14) ───

  @integration
  # @issue:176
  Scenario: The recipient opens one of their own notes in full
    Given user A has pinned a note to user B
    When user B fetches that note by its id
    Then it carries the same body and the same author card their note list carries
    And nothing in it is present that the list withheld

  @integration
  # @issue:176
  Scenario: A note names nobody, belongs to somebody else, or was written by you — one answer
    Given user A has pinned a note to user B
    And user C is connected to user B but not to user A
    When user C fetches that note by its id
    And user C fetches an id naming no note
    And user A fetches the note they pinned themselves
    Then all three are refused with NOTE_GONE
    And the three refusals are byte-identical

  @integration
  # @issue:176
  Scenario: A malformed note id is refused without reaching the database
    When a caller fetches a note by an id that is not a UUID
    Then it is refused as a bad request rather than as a driver-level failure
    And a well-formed id naming no note is still refused as NOTE_GONE

  @integration
  # @issue:176
  Scenario: An opened note outlives the connection that carried it
    Given user A has pinned a note to user B
    And the connection between them is severed
    When user B fetches that note by its id
    Then the note is still returned in full
    And it carries no author card and no trace of user A's identifier

  # The partial absence, as distinct from the total one above: there is still somebody
  # there to describe, and §6a is re-evaluated on this read rather than inherited from
  # whatever the list disclosed when the card was drawn.
  @integration
  # @issue:176
  Scenario: An author who discloses only limited is opened with no name
    Given user A has pinned a note to user B
    And user A discloses only their presence to user B
    When user B fetches that note by its id
    Then the note is returned in full and still carries user A's card
    And the card carries no display name and no handle

  @unit
  # @issue:176
  Scenario: The expanded view offers to pin back only when there is somebody to address
    Given a note on the viewer's board and the viewer's own graph
    When the sheet decides what to offer
    Then an author who is still a direct connection gets the pin-back control
    And an author further away than one hop gets the distance and no control
    And an author with no card at all gets nothing, and no recipient derived from anywhere
    And a graph read that has not landed is its own silence, never a claim the author is out of reach

  @unit
  # @issue:176
  Scenario: The expanded view reads the server's copy and falls back to the card's
    Given a note card the viewer has tapped
    When the sheet fetches that note by its id
    Then the server's copy replaces the card's once it lands
    And a read that failed leaves the card's copy on screen and claims nothing about the note
    And NOTE_GONE says the copy is stale without taking it away

  @e2e
  # @issue:176
  Scenario: A note opens into its expanded view, and can be pinned back from there
    Given user A has pinned a note to user B's board
    When user B taps the note and follows the pin-back control
    And user B writes and pins an answer
    Then the answer lands on user A's board as a note of its own
    And nothing about the note it answered has changed
