Feature: The M2 vertical slice, end to end
  As the implementation team
  I want the addendum §23 flow proven in one continuous run
  So that M2 is demonstrably done rather than done in isolated pieces

  # This feature is the composite proof point for M2-AC1. The individual @e2e scenarios
  # in the other M2 feature files decompose the same flow line-by-line for independent
  # module-level suites; this scenario is the single Playwright run that proves they
  # compose into one working slice, per addendum §23 and §21.

  @e2e
  # @ac:M2-AC1
  Scenario: The full addendum §23 flow passes as eleven named steps
    Given two browser contexts, one per user
    When the run drives, as eleven named test.step()s:
      | step | description                                                      |
      | 1    | User A signs in                                                  |
      | 2    | User A creates an invite                                         |
      | 3    | User B opens the invite                                          |
      | 4    | User B accepts the invite                                        |
      | 5    | User A assigns private directional trust to user B               |
      | 6    | The graph renders the accepted connection for both users         |
      | 7    | User A creates a Request bulletin                                |
      | 8    | User B, an eligible viewer, sees the bulletin                    |
      | 9    | Notify Me produces a grouped notification for a matching viewer  |
      | 10   | User B dismisses or privately reports the bulletin               |
      | 11   | User A archives the bulletin, and one mutation replays from offline state |
    Then all eleven steps pass
    And a skipped step is visible as a missing step in the report

  @integration
  # @ac:M2-AC16
  Scenario: The captured logs from a full slice run contain no sensitive data
    Given the full slice flow has run with log capture enabled
    When the captured logs are searched for the four canary strings — bulletin body,
      invite token, JWT, and email address
    Then zero matches are found for any of the four canaries
