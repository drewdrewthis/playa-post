Feature: Edit your display name — the one part of your identity that is yours to change
  As someone whose name changed, or who typed it wrong when they joined
  I want to edit the name other people see
  So that the person my connections recognise is the person I am now

  # Issue #177, decision D15.
  #
  # ⚠ **The handle is deliberately not editable, and this feature does not make it so.**
  # ADR-0008 rule 4 makes a handle immutable as an anti-impersonation measure: re-issuing
  # a retired handle lets its next holder inherit shared links and real-world
  # recognition, in a network built on recognition. #177 asked whether to reopen that;
  # decision D15 answers no, and names ADR-0008 as the blocker for anyone who wants to.
  # The refusal is *audible* rather than silent — `identity.updateDisplayName`'s input is
  # a `strictObject`, so a handle sent alongside the name is refused rather than dropped
  # — which is the same reasoning `decide-intro.input.ts` records for a note sent with a
  # decline (D11).
  #
  # Two absences below are deliberate and would otherwise read as gaps:
  #
  # **There is no `identity.displayName.get`.** A person's own name already arrives on
  # `graph.list` — they are on their own graph at degree 0 with `full` disclosure — and a
  # second answer to "what am I called" is a second thing that can disagree. The sibling
  # `identity.visibility` is a namespace because it genuinely has two operations.
  #
  # **There is no outbox event.** Every rendering of a name is projected from
  # `app.users.display_name` at read time through `app.visible_people`'s disclosure gate
  # (ADR-0002 §6a), so no derived copy exists anywhere for an event to go and correct —
  # and `UserOnboarded` already refuses to carry a display name into `app.outbox_events`
  # on the grounds that a durable, widely-read log is the wrong home for personal data.
  # An event whose whole payload was the new name would durably record every name a
  # person has ever gone by. The scenario below states the consequence positively: the
  # next read is already correct, with nothing to invalidate.
  #
  # The bounds are not new. They are onboarding's, shared rather than restated
  # (`transport/display-name.ts`), so the name you may rename yourself to is exactly the
  # name you could have joined under.

  @integration
  # @ac:177-AC1
  Scenario: A person changes their own display name
    Given an onboarded person called "Dusty Rhodes"
    When they submit the display name "Dust Storm"
    Then their stored display name is "Dust Storm"
    And the response echoes the name that was stored

  @integration
  # @ac:177-AC1
  Scenario: A display name is stored trimmed
    Given an onboarded person called "Dusty Rhodes"
    When they submit the display name "  Dust Storm  "
    Then their stored display name is "Dust Storm"

  @integration
  # @ac:177-AC2
  Scenario: A rename reaches only the caller's own row
    Given two onboarded people
    When one of them changes their display name
    Then the other person's display name is unchanged

  @integration
  # @ac:177-AC2
  Scenario: One payload renames two different callers
    Given two onboarded people
    When each of them submits the identical display-name payload in turn
    Then each person's own row carries the new name
    And neither call could have named the other, because the payload carries no identifier

  @integration
  # @ac:177-AC2
  Scenario: A payload naming another person is refused
    Given two onboarded people
    When one submits a display name together with the other's user id
    Then the request is rejected
    And neither person's display name is changed

  @integration
  # @ac:177-AC4
  Scenario: The handle survives a rename and still resolves to the same person
    Given an onboarded person with handle "dusty_handle"
    When they change their display name
    Then their handle is still "dusty_handle"
    And looking that handle up returns the same person under the new name

  @integration
  # @ac:177-AC3
  Scenario: A handle offered alongside the name is refused
    Given an onboarded person with handle "dusty_immutable"
    When they submit a new display name together with a new handle
    Then the request is rejected
    And their handle is unchanged

  @integration
  # @ac:177-AC5
  Scenario: The edited name is what a connected viewer's next read returns
    Given a person visible to a connected viewer at full disclosure
    When that person changes their display name
    Then the viewer's next read of the authorized person set returns the new name
    And nothing was published and nothing was re-projected to make that true

  @integration
  # @ac:177-AC5
  Scenario: A rename discloses no name to a viewer the projection withholds it from
    Given a person two degrees away from a viewer, whose name is therefore withheld
    When that person changes their display name
    Then the viewer still sees them on the graph with no name at all

  @integration
  # @ac:177-AC1
  Scenario: A refused name leaves the stored one untouched
    Given an onboarded person called "Dusty Rhodes"
    When they submit a name that is empty, whitespace, or over the length bound
    Then the request is rejected
    And their stored display name is still "Dusty Rhodes"

  @integration
  # @ac:177-AC1
  Scenario: A rename does not bump the row's version
    Given an onboarded person
    When they change their display name
    Then the row's version is what it was before

  @unit
  # @ac:177-AC1
  Scenario: The edit accepts exactly what onboarding accepts
    Given the display-name schema onboarding validates against
    When the same name is offered to the rename schema
    Then both schemas agree, for every name tried

  @unit
  # @ac:177-AC1
  Scenario: A name that is only whitespace is refused
    When a display name of spaces, tabs, or nothing at all is submitted
    Then it is rejected, because trimming happens before the length check

  @unit
  # @ac:177-AC1
  Scenario: A name longer than the bound is refused
    When a display name one character past the maximum is submitted
    Then it is rejected
    And a name of exactly the maximum is accepted

  @unit
  # @ac:177-AC2
  Scenario: The rename input carries nothing but the name
    When a display name is submitted with a user id, viewer id, actor id, owner id, or handle
    Then the request is rejected rather than the extra field being silently dropped

  @unit
  # @ac:177-AC4
  Scenario: A rename leaves every other column alone
    Given a stored person with a handle, a visibility setting, and a status
    When their display name is changed
    Then the handle, the visibility setting, the status, and the creation time are unchanged

  @unit
  # @ac:177-AC1
  Scenario: The caller is told what was stored, not what was asked for
    Given a store that answers with a different name than the one it was handed
    When a rename is performed
    Then the caller is told the stored name

  @e2e
  # @ac:177-AC1 @ac:177-AC5
  Scenario: Renaming on the You screen comes back changed from the server
    Given a signed-in person on the You screen
    When they edit their display name and save it
    Then the heading shows the new name, refetched rather than echoed
    And it survives a reload
