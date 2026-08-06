-- Allowed counterpart: references only modules/bulletins' own table (app.bulletins)
-- plus a sanctioned app.visible_* function call — app.visible_people(...) — never
-- app.connections or app.users directly. Mirrors the shape
-- modules/bulletins/persistence/sql/visible-bulletins.sql will actually take
-- (ADR-0004:75-77, m2-lane-briefs.md §L3a: "it composes rather than re-derives").
select b.id, b.author_id, b.type, b.title, b.body, b.created_at
  from app.bulletins b
  join app.visible_people(:viewer_id) vp on vp.user_id = b.author_id
 where b.archived_at is null;
