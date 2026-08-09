# Product decisions log

Decisions delegated to the implementation lead by the product owner (2026-07-30: "I think you can make best decisions here"), resolving spec↔prototype discrepancies. The handoff PDF is authoritative for product behavior; the prototype is product evidence for UX feel.

## D1 — Notify Me is a single saved query (2026-07-30)

Conflict: PDF §4 "one special saved query called Notify Me"; prototype shows a notify bell on every saved view.
Decision: **PDF wins.** Exactly one Notify Me query per user (confirmed by addendum §6's `UpdateNotifyMeQuery`, singular). The prototype's per-view bell becomes the UI affordance for designating *which* view's query is the Notify Me query — toggling a bell on view B moves Notify Me from view A (with clear UI feedback), it does not create a second notifying query.

## D2 — No private notes in v1; bulletin types follow the PDF (2026-07-30)

Conflict: prototype has a "private note to a person's board" compose mode (type `note`, audience "Only <name>"); PDF's bulletin type list is Offer, Request, Event, Collaboration, Appreciation, Network Update, Introduction Request — no `note` — and v1 explicitly excludes native messaging.
Decision: **Cut private notes from v1.** They are fixed-recipient messaging in disguise, which the PDF both excludes and flags for a separate future evaluation (§6 "A future fixed-recipient private messaging feature… must not be silently mixed into the bulletin model"). Implement the PDF's seven types, including Network Update. The compose sheet's note mode is not built.

## D3 — Operator moderation; "stewards" allowed as UI copy only (2026-07-30)

Conflict: prototype report-sheet copy promises "stewards will review"; PDF specifies single-operator moderation with no report aggregation and no outcome visibility.
Decision: **Implement operator moderation exactly per PDF §5 and addendum §16.** UI copy may use community-toned language ("stewards") if final copy wants it, but it must not promise review timelines, outcomes, or community juries. Default copy: "Your report was sent privately for review."

## D4 — Notifications entry is a drawn bell, not the comp's ◔ glyph (2026-08-10, owner-directed)

Conflict: the comp (`design/Playa Post.dc.html`) draws the notifications button's mark as the text glyph ◔; owner directive #91 says the entry "should actually be a little bell icon."
Decision: **Owner wins — inline SVG bell.** ◔ does not read as notifications at a glance, and an emoji bell cannot take the theme's ink colour; an inline SVG stroked in `currentColor` and sized in `em` follows `.icon-button`'s theme ink and font-size scaling like the glyph it replaced. Scope: a one-off override, not the start of an icon migration — the remaining chrome glyphs (☾/☀ theme toggle, tab bar, graph zoom) stay text glyphs until a reason arrives. If a second drawn icon lands, decide the chrome icon convention first (the precedent set here: inline SVG, `currentColor` stroke, `em`-sized) and consider a shared icon module at the third.

## D5 — Six postable types; Network Update is system-written, label-only typing for now (2026-08-10)

Conflict: D2 adopts the PDF's seven bulletin types including Network Update, but the prototype's compose surface offers only six (`design/Playa Post.dc.html:892` — no `update` chip), and nothing in v1 scope produces a network update.
Decision: **The postable set is the prototype's six** — offer, request, event, collab, thanks, intro. `update` remains a member of the board grammar's `type:` vocabulary (ADR-0007) so the filter parses, but no person can compose one: a network update is something the *system* writes when that feature arrives, and until it does, `type:update` resolves to an empty board rather than an error. `create` refuses `update` (and `note`, per D2) by naming the field. Corollary, recorded so the model is deliberate rather than accidental: in M5 a bulletin's type is a *label* — classification, tint, and filter key — with no per-type structure (an `event` has no start time; `expiresAt` remains visibility-end for every type). The day a type grows structure, that is a discriminated-union change with its own decision, not a silent widening.

---

Escalation threshold for future decisions: addendum §24. Anything touching user experience, trust/privacy model, irreversible data constraints, significant operational cost, or custom infrastructure goes back to the owner.
