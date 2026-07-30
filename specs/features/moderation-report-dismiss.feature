Feature: Moderation — private reporting and viewer-local dismissal
  As an eligible viewer
  I want to privately report or dismiss a bulletin
  So that I can act on unwanted content without the author ever knowing

  # M2 scope: private report of a bulletin → immediately hidden for the reporter;
  # viewer-local dismissal. Cut to M5: reason taxonomy, operator console + app_operator_ro,
  # hide-author, blocking, withdrawal.

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
