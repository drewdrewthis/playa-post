Feature: Request an intro — asking a mutual connection to introduce you
  As someone who can see a person two hops away
  I want to ask the person we both know to introduce us
  So that meeting a stranger goes through somebody who knows us both, not around them

  # Issue #89. An intro travels **exactly one hop**: the target stands at degree 2, and
  # the via is somebody directly connected to both parties. Degree 1 needs no
  # introduction; degree 3 or beyond would be a chain nobody in it agreed to.
  #
  # ⚠ The load-bearing privacy invariant: **a declined request is invisible to the target
  # forever.** The target must never be able to distinguish "somebody asked and was
  # declined" from "nobody asked" — that is what makes declining safe for the via, and it
  # is asserted by deep equality against a control user standing in the same graph
  # position, never by an absent-field check.
  #
  # ⚠ The second one, which points the other way: **asking is consent to be seen.** If the
  # via passes it on, the target is shown the requester's identity and note even when the
  # requester's own `visible_to_distance` would hide them from somebody two hops away. The
  # sheet says so before send.
  #
  # ⚠ Issue #175 gives the pass-on a third: **the via must add a note of their own**
  # (owner: "you have to add your own message", decision D11). A pass-on is a vouch rather
  # than a forward, so the target reads two notes by two people, each under its own
  # author's card — and passing one on is therefore consent to be *named* as its via, the
  # same inversion the requester's own card rests on. A decline still carries nothing, and
  # a note attached to one is refused rather than dropped: the requester is told only that
  # it was not passed on, so there is no reader for it.
  #
  # Its own aggregate, never a note subtype (decision recorded in
  # `modules/intros/domain/intro-request.ts`): a note has two parties and no lifecycle;
  # this has three parties, three states, and a second actor who decides. What is reused
  # is the *idiom* — the same textarea, the same 1–4000 bound — not the table.
  #
  # Eligibility is decided **inside the insert**, and again **inside a pass-on**, by
  # `app.intro_via_candidates`, which composes `app.visible_people` on both sides. A
  # request is not a snapshot of the graph it was made in.
  #
  # Two absences below are deliberate and would otherwise read as gaps:
  #
  # There is no scenario for what the target *does* after an introduction. #89 ends at
  # "the target sees it"; minting a connection from an intro is a new authorization path
  # and belongs to its own issue.
  #
  # There is no offline-replay scenario. `intros.request` is deliberately absent from
  # `QUEUED_MUTATION_TYPES` — eligibility is time-varying, so a queued ask could drain into
  # a graph where it is no longer true, and ADR-0005's conflict matrix defines no
  # resolution for that.
  #
  # The `@integration` scenarios are in
  # `modules/intros/tests/integration/request-an-intro.integration.test.ts`; the
  # eligibility-set scenarios in `intro-via-candidates.integration.test.ts`; the catalog
  # shape in `intro-requests-migration.integration.test.ts`.

  @integration
  # @issue:89
  Scenario: An intro request reaches its via and nobody else
    Given user A and user B are directly connected
    And user B is directly connected to user C, to user X and to user D
    When user A asks user B for an introduction to user C
    Then one intro request is stored as requested, with no decision
    And user B's intro inbox carries it in the "via" role, naming user A, user C and the note
    And user C's intro inbox is identical to user X's, who nobody has asked about

  @integration
  # @issue:89
  Scenario: Every ineligible target is refused identically
    Given user A can see people at one, three and six degrees
    And a second-degree person who has deactivated
    And a second-degree person whose own reach setting stops at first degree
    When user A attempts to request an intro to each of them, to themselves, and to a user ID naming nobody
    Then all seven attempts are refused with the identical INTRO_UNAVAILABLE
    And no intro request row is written
    And no outbox event is written

  @integration
  # @issue:89
  Scenario: A via who does not know the target is refused the same way as a via who does not exist
    Given user A and user F are directly connected
    And user F is not connected to user C
    When user A attempts to request an intro to user C through user F
    And user A attempts to request an intro to user C through a user ID naming nobody
    Then both attempts are refused identically, disclosing nothing about who knows whom
    And the same request through a genuine shared connection succeeds

  @integration
  # @issue:89
  Scenario: One open request per pair, whatever the via
    Given user A has an open intro request to user C through user B
    When user A attempts a second request to user C through a different shared connection
    Then the attempt is refused as INTRO_UNAVAILABLE, never as a constraint violation
    And exactly one intro request row exists
    And two simultaneous requests for the same pair leave exactly one row

  @integration
  # @issue:89
  Scenario: Only the named via may decide
    Given user A has an open intro request to user C through user B
    When the requester, the target, a fourth party, or the via naming a request that does not exist attempts to decide it
    Then all four attempts are refused with the identical INTRO_UNAVAILABLE
    And the request is still requested, with no decision
    And no further outbox event is written

  @integration
  # @issue:89
  Scenario: A decision is made once
    Given user B has passed on user A's request to user C
    When user B attempts to decide it again, in either direction
    Then the attempt is refused and the recorded decision time is unchanged
    And two simultaneous decisions leave exactly one winner and one refusal

  @integration
  # @issue:89
  Scenario: A pass-on whose eligibility has lapsed is refused, and a decline is not
    Given user A has an open intro request to user C through user B
    And user B and user C are no longer connected
    When user B attempts to pass it on
    Then the attempt is refused as INTRO_UNAVAILABLE
    And user C's intro inbox is still identical to the never-asked control's
    And user B can still decline it

  @integration
  # @issue:89
  Scenario: A pass-on is refused when the target has lowered their own reach
    Given user A has an open intro request to user C through user B
    And user C has since set their reach to first degree only
    When user B attempts to pass it on
    Then the attempt is refused and the request stays open

  @integration
  # @issue:89
  Scenario: A declined request is invisible to its target forever
    Given user B has declined user A's request to introduce them to user C
    Then every intros read answers user C exactly as it answers user X, who nobody asked about
    And user A's own record shows "not passed on", with no reason and no note

  @integration
  # @issue:89
  Scenario: The intro inbox is dual-role and never any other combination
    Given user A has an open intro request to user C through user B
    Then user B holds it in the "via" role and user C sees nothing
    When user B passes it on
    Then user C holds it in the "target" role, with user A's identity and the note
    And the row carries no target card, because the target is the reader
    And user B's inbox is empty, and user A's inbox was never involved

  @integration
  # @issue:89
  Scenario: A fourth party sees nothing
    Given user B has passed on user A's request to introduce them to user C
    Then user D, who stands beside user C and was never involved, reads exactly what the never-asked control reads

  @integration
  # @issue:89
  Scenario: Asking is consent to be seen
    Given user A's own reach setting hides them from anybody beyond first degree
    And user C therefore cannot otherwise see that user A exists
    When user A asks user B for an introduction and user B passes it on
    Then user C is shown user A's identity and the note
    And user A deactivating afterwards removes the card and leaves the introduction

  @unit @integration
  # @issue:175
  Scenario: Passing an intro on requires a note of the via's own
    Given user A has an open intro request to user C through user B
    When user B passes it on with a note of their own
    Then the note is stored on the same row, trimmed, by the same statement as the decision
    And user C reads both notes, each under its own author's card
    And a pass-on carrying no note, a whitespace-only one, or one over 4000 characters is refused
    And the request is still requested, with no decision and no via note

  @unit @integration
  # @issue:175
  Scenario: A decline carries no note
    Given user A has an open intro request to user C through user B
    When user B attempts to decline it with a note attached
    Then the attempt is refused rather than the note being silently dropped
    And an ordinary decline succeeds and stores no via note

  @integration
  # @issue:175
  Scenario: The via's note is for the target and nobody else
    Given user B has passed on user A's request to user C with a note of their own
    Then user A's own record carries the status and neither note
    And user B cannot read their own note back on any intros read
    And no outbox payload and no captured log line contains it

  @integration
  # @issue:175
  Scenario: Passing an intro on is consent to be named as its via
    Given user B has passed on user A's request to user C with a note of their own
    When user B and user C are no longer connected
    Then user C still reads the note with user B's own self-projected card beside it
    And user B deactivating instead leaves the note standing with no card at all

  @unit @integration
  # @issue:89
  Scenario: The intro note is trimmed, bounded, and never empty
    Given a note that is empty, whitespace-only, or longer than 4000 characters after trimming
    When user A attempts to request an intro
    Then the attempt is refused as INTRO_CONTENT_INVALID
    And the same refusal is returned for an unreachable target, so the refusal discloses no reachability
    And no intro request row is written

  @integration
  # @issue:89
  Scenario: Events ride the same transaction and carry no note
    When user A requests an intro, user B passes one on, and user B declines another
    Then IntroRequested, IntroPassedOn and IntroDeclined are written, carrying identifiers only
    And a forced failure after the state write leaves neither the row nor the event
    And no captured log line contains the note

  @integration
  # @issue:89
  Scenario: The requester's own record carries every state and no note
    Given user A has one passed-on, one declined and one open intro request
    When user A reads their own record
    Then all three appear with their status and the via's projected identity
    And none of them carries the note

  @unit
  # @issue:89
  Scenario: The intros contract declares every procedure the router serves
    Given the intros router mounts five procedures
    Then packages/contracts declares all five and the parity fitness test is green
    And no intros procedure accepts a viewer, user, actor or owner identifier in its input
