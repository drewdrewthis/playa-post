Feature: Graph visibility — first-degree accepted connections
  As a signed-in user
  I want my graph to show the people I am actually connected to
  So that no one outside my accepted connections is exposed to me or through me

  # M2 scope: app.visible_people recursive CTE (ADR-0004) rendering the viewer + accepted
  # 1st-degree connections; disclosure levels present and enforced by the §6a projection rule.
  # Cut to M5: ghost/topology-only nodes, degrees ≥ 2, path_via, truncation UI, clustering,
  # perf gate.

  @e2e
  # @ac:M2-AC1
  # Addendum §21 critical-flow matrix item: "Graph visibility"
  Scenario: The graph renders the viewer's accepted connection
    Given user A and user B have an accepted connection
    When user A requests their graph
    Then user B appears in user A's graph as a first-degree connection

  @integration
  # @ac:M2-AC5
  Scenario: A viewer with no relationship to either party gets zero graph rows
    Given user A and user B have an accepted connection
    And user C has no relationship to user A or user B
    When user C requests their graph
    Then user C's graph contains zero rows referencing user A or user B

  @integration
  # @ac:M2-AC5
  # ADR-0002 §6a person-projection rule, applied to the graph surface
  Scenario: A connection below full disclosure renders with no identifying fields
    Given user A and user B have an accepted connection
    And user B's disclosure level toward user A is below full
    When user A requests their graph
    Then user B's node contains no name, handle, or avatar
