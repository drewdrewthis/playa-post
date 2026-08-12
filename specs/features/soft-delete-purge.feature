Feature: Deleting is soft everywhere, and soft-deleted rows do not live forever
  As someone who removed a bulletin or deleted a saved view
  I want it gone from every screen straight away, and genuinely gone before long
  So that "remove" means what it says without a mistake being unrecoverable the instant I make it

  # Issue #169, decision D17. Related prior art: issue #118, which named the purge gap.
  #
  # Two halves, and neither is worth much alone. A soft delete with no purge means
  # "removed" is a synonym for "hidden and kept indefinitely" — which is what this
  # repository shipped, and what #118 complained about. A purge with no soft delete is
  # just a delete. Together they are one policy: a delete takes effect immediately from
  # every surface, and the row behind it survives a configurable window and then stops
  # existing.
  #
  # **Where each entity stood before this feature:**
  #
  # * `app.bulletins.archived_at` was already a soft delete — decision D9 renamed the
  #   action to "Remove", kept the mechanism, and deferred *how long the row lives* to
  #   here. Nothing about the write path changes; `archived_at` IS the soft-delete column.
  # * `app.saved_views` hard-deleted. That is the half this feature changes.
  # * `app.notes` has no delete at all, and **still has none**. D6 made notes immutable
  #   and pin-only; D14 revisited that and deliberately kept it. There is no user-facing
  #   delete to make soft, so a `deleted_at` here would be a column no mutation ever sets
  #   — see D17. The scenario asserting the purge leaves notes alone is the record of
  #   that, positively stated.
  #
  # ⚠ **The purge covers user-deleted state only.** An expired-but-never-removed bulletin
  # is still its author's and is untouched. ADR-0006's own retention chores — pruning
  # `published` outbox rows at fourteen days, and `app.mutation_results` daily — are also
  # untouched and remain issue #118's scope: they are a debugging-retention policy about
  # infrastructure, and folding them in here would put two unrelated windows behind one
  # configuration key.
  #
  # ⚠ **The purge announces nothing.** No outbox event, from the sweep or from either
  # store it sweeps. The state change was the delete, a month earlier, and it published
  # whatever it owed then; an event here would tell a consumer "this was deleted" about
  # something already absent from every read since, and would durably record that a
  # person deleted something long after the fact (ADR-0006, M2-AC16). What is recorded is
  # a count, in a log line carrying no identifier.

  @integration
  # @ac:169-AC1
  Scenario: Deleting a saved view keeps the row and shows it to nobody
    Given a person with a saved view
    When they delete it
    Then the view is absent from their saved views
    And the row is still stored, stamped with the moment they deleted it

  @integration
  # @ac:169-AC1
  Scenario: Deleting the same saved view twice reports the second as a no-op
    Given a person who has deleted a saved view
    When they delete it again
    Then the request succeeds reporting that nothing was removed
    And the stored deletion stamp is unchanged

  @integration
  # @ac:169-AC1
  Scenario: A deleted saved view frees its name and its slot immediately
    Given a person holding the maximum number of saved views
    When they delete one of them
    Then they can save a new view under the deleted one's name

  @integration
  # @ac:169-AC1
  Scenario: A deleted saved view cannot be renamed back into existence
    Given a person who has deleted a saved view
    When a client holding a stale list renames it
    Then the rename is refused as a conflict
    And the view is still absent from their saved views

  @integration
  # @ac:169-AC1
  Scenario: A deleted saved view cannot have its Notify Me bell lit
    Given a person who has deleted a saved view
    When they switch its Notify Me bell on
    Then the request is refused exactly as it is for a view id that names nothing

  @integration
  # @ac:169-AC1
  Scenario: Deleting a saved view stops its notifications outright
    Given a person with the Notify Me bell lit on a saved view
    When they delete that view
    Then the Notify Me query behind the bell is removed rather than soft-deleted
    And exactly one Notify Me cleared event is published

  @integration
  # @ac:169-AC4
  Scenario: A removed bulletin older than the window is purged
    Given a bulletin its author removed 31 days ago
    And a retention window of 30 days
    When the purge runs
    Then the bulletin no longer exists

  @integration
  # @ac:169-AC4
  Scenario: A removed bulletin younger than the window is retained
    Given a bulletin its author removed 29 days ago
    And a retention window of 30 days
    When the purge runs
    Then the bulletin still exists

  @integration
  # @ac:169-AC4
  Scenario: A deleted saved view older than the window is purged, and a younger one is retained
    Given saved views deleted 31 days ago and 29 days ago
    And a retention window of 30 days
    When the purge runs
    Then only the older one no longer exists

  @integration
  # @ac:169-AC2 @ac:169-AC3
  Scenario: The purge follows the configured window rather than a built-in one
    Given rows deleted 8 days ago and 6 days ago
    And a retention window of 7 days
    When the purge runs
    Then only the rows deleted 8 days ago no longer exist

  @unit
  # @ac:169-AC3
  Scenario: A retention window of zero days is refused at boot
    Given an environment setting the purge retention window to 0
    When the server loads its configuration
    Then it fails naming the key and never its value

  @unit
  # @ac:169-AC2
  Scenario: Two stores sharing a window are swept against one cutoff
    Given a purge over two stores keeping rows for the same number of days
    When one round runs
    Then both stores are given the same instant to sweep before

  @unit
  # @ac:169-AC3
  Scenario: A store keeping rows longer is swept against its own cutoff
    Given a purge over two stores keeping rows for different numbers of days
    When one round runs
    Then each store is given the instant its own window puts on that round

  @unit
  # @ac:169-AC2
  Scenario: The purge is scheduled by the running server
    Given the server entrypoint
    Then it starts every background loop the codebase declares, and stops each one on shutdown

  @unit
  # @ac:169-AC4
  Scenario: Nothing but the purge deletes a bulletin
    Given the server codebase
    Then the retention sweep is the only statement that deletes a bulletin, so the cascade onto reports and dismissals can fire from nowhere else

  @integration
  # @ac:169-AC4
  Scenario: Purging a bulletin takes its reports and dismissals with it
    Given a removed bulletin older than the window that somebody reported and dismissed
    When the purge runs
    Then the bulletin, the report, and the dismissal are all gone
    And a retained bulletin's own report and dismissal are untouched

  @integration
  # @ac:169-AC4
  Scenario: Running the purge twice removes nothing the second time
    Given rows older than the window
    When the purge runs twice
    Then the second round reports that it removed nothing

  @integration
  # @ac:169-AC2
  Scenario: The purge publishes no events
    Given rows older than the window
    When the purge runs
    Then no outbox event is written

  @integration
  # @ac:169-AC2
  Scenario: A bulletin that merely expired is never purged
    Given a bulletin that expired a year ago and was never removed
    When the purge runs
    Then the bulletin still exists

  @integration
  # @ac:169-AC5
  Scenario: Notes are outside this feature and the purge leaves them alone
    Given a note pinned a year ago
    When the purge runs
    Then the note still exists
