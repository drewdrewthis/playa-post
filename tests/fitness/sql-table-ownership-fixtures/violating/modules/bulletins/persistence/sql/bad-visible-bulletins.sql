-- Deliberately-violating fixture for the sql-table-ownership rule: joins
-- app.connections directly, re-deriving reachability instead of composing
-- app.visible_people — exactly the R2 leak m2-lane-briefs.md §L3a's "it composes
-- rather than re-derives" rule exists to catch. Do not "fix" this file; see
-- tests/fitness/sql-table-ownership.fitness.test.ts.
select b.id, b.author_id
  from app.bulletins b
  join app.connections c
    on c.status = 'accepted' and (c.user_a_id = b.author_id or c.user_b_id = b.author_id);
