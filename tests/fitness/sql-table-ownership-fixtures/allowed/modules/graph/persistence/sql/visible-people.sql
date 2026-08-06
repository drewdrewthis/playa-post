-- Allowed counterpart: references only modules/graph's own table set as recorded
-- in sql-table-ownership-allowlist.json ("graph": ["connections", "connection_trust",
-- "users"]) plus a sanctioned app.visible_* function call. Mirrors the shape
-- modules/graph/persistence/sql/visible-people.sql will actually take.
with recursive reachable as (
  select u.id as user_id, u.handle, u.display_name
    from app.users u
   where u.id = app.visible_people(u.id)
), direct as (
  select c.user_a_id, c.user_b_id, t.trust
    from app.connections c
    left join app.connection_trust t
      on t.owner_id = c.user_a_id and t.subject_id = c.user_b_id
   where c.status = 'accepted'
)
select * from reachable, direct;
