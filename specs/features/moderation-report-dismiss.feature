Feature: Moderation — private reporting and viewer-local dismissal
  As an eligible viewer
  I want to privately report or dismiss a bulletin
  So that I can act on unwanted content without the author ever knowing

  # M2 scope: private report of a bulletin → immediately hidden for the reporter;
  # viewer-local dismissal. Cut to M5: reason taxonomy, operator console + app_operator_ro,
  # hide-author, blocking, withdrawal.
  #
  # Issue #170 adds the second half of dismissal: a Dismissed category the viewer can
  # browse, and a way back out of it. A dismissal was already viewer-local and
  # idempotent (M2-AC11); what it lacked was anywhere to go afterwards, which made it
  # indistinguishable from a deletion the viewer could not undo.
  #
  # ⚠ **Dismissals only.** There is still no "what have I reported" — that read is the
  # one M2-AC10/B9 refuses to build, and the scenarios below assert a reported bulletin
  # stays out of the browsable list. The category is on `bulletins`, not `moderation`,
  # for the same reason: `moderation` keeps zero read procedures.

  @e2e
  # @ac:M2-AC1
  # Addendum §21 critical-flow matrix item: "Bulletin reporting"
  Scenario: Reporting a bulletin immediately hides it from the reporter
    Given an eligible viewer sees a bulletin on their board
    When the viewer privately reports that bulletin
    Then the bulletin is absent from the reporter's board immediately

  @integration
  # @ac:M2-AC10
  Scenario: A reported bulletin remains visible to other eligible viewers
    Given viewer V has reported a bulletin authored by A
    And viewer W is another eligible viewer of that bulletin
    When viewer W requests their board
    Then the bulletin is still present on viewer W's board

  @integration
  # @ac:M2-AC10
  Scenario: The reporter's identity never reaches the author
    Given viewer V has reported a bulletin authored by A
    When author A reads the bulletin, their notifications, and their own bulletin list
    Then none of those responses contain viewer V's ID, handle, or display name

  @e2e
  # @ac:M2-AC11
  # Addendum §21 critical-flow matrix item: "Viewer-controlled dismissal"
  Scenario: Dismissing a bulletin removes it only for the dismissing viewer
    Given viewer V sees a bulletin on their board
    And viewer W is another eligible viewer of that bulletin
    When viewer V dismisses the bulletin
    Then the bulletin is absent from viewer V's board
    And the bulletin is still present on viewer W's board

  @integration
  # @ac:M2-AC18
  Scenario: Reporting your own bulletin is rejected
    Given a bulletin authored by user A
    When user A attempts to report their own bulletin
    Then the response is a structured error with a stable code

  @integration
  # @ac:M2-AC19
  Scenario: bulletin.report and bulletin.dismiss fail closed for an unrelated actor
    Given a bulletin authored by user A
    And an actor C with no relationship to that bulletin
    When actor C submits bulletin.report for it
    Then the response is a structured error
    And zero rows change on the reports table
    And zero rows are written to outbox_events

  @integration
  # @ac:M2-AC14
  Scenario: Reporting an invisible bulletin fails like reporting a non-existent one
    Given a bulletin the viewer is not authorized to see
    And a UUID that has never existed
    When the viewer submits a report against each
    Then both responses have identical status codes and identical bodies

  @integration
  # @issue:170
  Scenario: A dismissed bulletin is browsable in the viewer's dismissed category
    Given viewer V has dismissed a bulletin authored by A
    When viewer V requests their dismissed bulletins
    Then the bulletin is present in that list with its author's disclosure card
    And the bulletin is still absent from viewer V's board

  @integration
  # @issue:170
  Scenario: The dismissed category lists most-recently-dismissed first
    Given viewer V has dismissed three bulletins in a known order
    When viewer V requests their dismissed bulletins
    Then they are listed newest dismissal first, regardless of when each was posted

  @integration
  # @issue:170
  Scenario: The dismissed category never carries what the viewer reported
    Given viewer V has reported one bulletin and dismissed another
    When viewer V requests their dismissed bulletins
    Then only the dismissed bulletin is listed

  @integration
  # @issue:170
  Scenario: The dismissed category carries nobody else's dismissals
    Given viewer V and viewer W have each dismissed a different bulletin
    When viewer V requests their dismissed bulletins
    Then only the bulletin viewer V dismissed is listed

  @integration
  # @issue:170
  Scenario: The dismissed category only carries bulletins the viewer may still see
    Given viewer V has dismissed a bulletin authored by A
    And author A then archives that bulletin
    When viewer V requests their dismissed bulletins
    Then the list is empty

  @integration
  # @issue:170
  Scenario: Un-dismissing returns the bulletin to the default board
    Given viewer V has dismissed a bulletin
    When viewer V un-dismisses it
    Then the bulletin is present on viewer V's board again
    And viewer V's dismissed list is empty

  @integration
  # @issue:170
  Scenario: Un-dismissing something never dismissed succeeds and changes nothing
    Given a bulletin viewer V can see and has not dismissed
    When viewer V un-dismisses it
    Then the call succeeds
    And no dismissal row exists for viewer V

  @integration
  # @issue:170
  Scenario: Un-dismissing a bulletin the viewer also reported leaves it hidden
    Given viewer V has both dismissed and reported the same bulletin
    When viewer V un-dismisses it
    Then the bulletin is still absent from viewer V's board
    And the report is still recorded

  @integration
  # @issue:170
  Scenario: Dismissing leaves the bulletin untouched for its author
    Given viewer V has dismissed a bulletin authored by A
    When author A reads their own bulletin list
    Then the bulletin is present and is not archived

  @integration
  # @issue:170
  Scenario: bulletin.undismiss fails closed for an unrelated actor
    Given a bulletin authored by user A
    And an actor C with no relationship to that bulletin
    When actor C submits bulletin.undismiss for it
    Then the response is a structured error
    And zero rows change on the dismissals table
    And zero rows are written to outbox_events
