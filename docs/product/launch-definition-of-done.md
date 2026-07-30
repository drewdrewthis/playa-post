# Launch definition of done (owner-stated, 2026-07-30)

v1 is DONE only when ALL of the following hold, verified — not asserted:

1. **Live** — the app is deployed and reachable at a real URL (production, not a local run or preview).
2. **Working, not mocked** — every feature operates against the real backend (real Postgres, real auth, real push, real queue/worker). No mock layers, stub data services, or disabled code paths in the deployed app.
3. **Real data** — a small set of seed users/connections/bulletins exists so the product is experienceable immediately; seeds are honest product data, not fixtures that hide broken paths.
4. **Tested from the user's perspective** — end-to-end walkthroughs of the real deployed app as a user would use it (browser-driven: sign in via magic link, invite, accept, trust, graph, bulletin, notify, dismiss/report, archive, offline replay), with evidence captured (screenshots/recordings + steps).
5. **Visually correct** — the deployed UI matches the settled prototype (design/Playa Post.dc.html): themes, layout, graph feel, sheets, typography. Visual QA compares against the prototype, not just "renders without errors".
6. **Feature complete** — the full v1 scope of the handoff PDF §3 "Included" list, as modified by docs/product/decisions.md. Partial scope is not done.

QA review is a first-class gate: a user-perspective QA pass (independent of the implementers) must sign off on 1–6 before "live" is claimed to the owner.
