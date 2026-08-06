-- Deliberately-violating fixture for the sql-table-ownership rule: joins
-- app.bulletins directly, re-deriving reachability into a table `modules/graph`
-- does not own and that is not in its allowlist — exactly the R2 leak the rule
-- exists to catch. Do not "fix" this file; see
-- tests/fitness/sql-table-ownership.fitness.test.ts.
select c.user_a_id, c.user_b_id, b.id as bulletin_id
  from app.connections c
  join app.bulletins b on b.author_id = c.user_b_id
 where c.status = 'accepted';
