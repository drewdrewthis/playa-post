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

## D6 — Private notes are back, as a separate module and never a bulletin type (2026-08-10, owner-directed)

Conflict: **D2 cut private notes from v1**; the owner directive behind [#88](https://github.com/drewdrewthis/playa-post/issues/88) reopens them ("Pin a note").
Decision: **Owner wins on the feature; the PDF still wins on the shape.** D2's *reasoning* was never that notes are unwanted — it was PDF §6: "A future fixed-recipient private messaging feature… must not be silently mixed into the bulletin model." That constraint is unchanged, so the feature returns only in the form that honours it, and the separation is structural rather than a naming convention:

- its own table (`app.notes`) and its own authorized set (`app.visible_notes`), which composes `app.visible_people` for the author card only — the authorization is `recipient_id = viewer_id`;
- its own module (`modules/notes`) and its own router, mounted **beside** `bulletins`, never inside it;
- `bulletins.create` still refuses the value `note`, and `bulletin-post-types.feature`'s refusal scenario is deliberately untouched;
- notes never enter the **bulletin board query**, a saved-view query, or the free-text haystack. There is no tsvector over `app.notes`, so no grammar can ever reach a note's text. What the recipient's board *does* do is load `app.visible_notes` as a **second, separate read** and interleave the two kinds of card by time — one screen, two queries, and the notes half is dropped entirely the moment a query or a saved view is active, because a note must never be something a search can return. The separation D6 is defending is of the *query surface*, not of the pixels: mixing notes into `app.visible_bulletins` would make a note reachable by the grammar, whereas showing them side by side does not.

**Degree 1 is the only gate.** A note may be pinned to a first-degree connection and to nobody else, and the check lives inside the insert statement (`INSERT … SELECT … WHERE EXISTS` over `app.visible_people`), so a refusal writes no row. "Not connected", "two hops away", "no such person", "no longer active", and "that is yourself" are one indistinguishable refusal (`NOTE_RECIPIENT_UNREACHABLE`, HTTP 404) — a product with no people search cannot afford an endpoint that confirms who exists.

**A delivered note is the recipient's, and only the author *card* is revocable.** Degree 1 gates the *pinning*; nothing re-derives it at read time. Once a note is delivered, severing the connection, the author deactivating, or the author lowering their disclosure may each change what the recipient is told about **who wrote it** — down to and including being told nothing, not even a user ID — and none of them removes **what they were told**. `app.visible_notes` therefore LEFT-joins `app.visible_people` and projects every author column from that set, which is the one place notes deliberately diverge from bulletins: a bulletin is published outward and rightly leaves with its author, whereas a note was addressed and handed over. The alternative — an INNER join, so a note silently disappears off somebody's board because a third party changed a setting — is this product quietly editing what a person was told, and is a worse failure than an unattributed note. A client renders an authorless note with no author line and never a reconstructed one.

**Deferred, pending an owner decision: the comp's "WHO CAN PIN TO YOUR BOARD" control.** The comp offers a three-valued trust/distance pair for it, which contradicts its own degree-1 gate — if only direct connections can pin, a "second degree" or "anyone" setting has nothing to widen to, and a trust threshold is a different axis again (trust is private and directional, ADR-0004 decision 6, so a threshold would leak the setter's private number through who succeeds at pinning). Rather than guess which of those the control means, the recipient-side limit is not built: degree 1 is the whole rule for now. This is a UX and trust-model question, which addendum §24 sends back to the owner.

Corollary: a note has no update and no take-down in this slice, so `app.notes` carries neither a `version` nor an `archived_at` column. Both arrive with the mutation that needs them (addendum §4 forbids the placeholder), and `version` specifically arrives with the first mutation ADR-0005 marks `expectedVersion: yes`.

## D7 — "Seen" fires the moment the notifications panel opens, not per notification scrolled into view (2026-08-11)

Conflict: [#178](https://github.com/drewdrewthis/playa-post/issues/178) says the bell badge must fall when a person opens their notifications panel, without making them dismiss each row. "Opened it" admits two readings — the panel opened, or each notification was actually scrolled onto the screen — and the ACs deliberately ask for the choice to be recorded rather than assumed.

Decision: **the panel opening is the event.** One `notifications.markSeen` per opening, advancing a single per-person watermark (`app.notification_seen_watermarks.last_seen_at`); `notifications.list` then serves `seen` as `occurredAt <= last_seen_at`. Scroll-into-view would need an IntersectionObserver per row, a client-sent list of identifiers, and a rule for a row that was half on screen — for no user-visible difference at the list sizes this product produces, where the panel is a full-column takeover and opening it puts essentially the whole list in front of the reader. Addendum §24's "simplest proven implementation" resolves it, and the watermark is also the only version that cannot lie: a client sending the ids it happened to be holding would silently mark seen whatever arrived between its read and its write, whereas "everything up to now" names nothing and cannot race a read.

**Seen is not dismissed, and the two states stay separate on purpose.** Seen answers "has anything happened since you last looked" and is the *only* thing the badge counts (`unread && !seen`); dismissed answers "have you dealt with this" and is the only thing that moves a row out of the panel's active section. Opening the panel therefore changes nothing on screen — every row the reader came for is exactly where it was — which is why the badge and the panel could be given one flag each rather than one flag between them. All four combinations are reachable and each means something.

Corollaries, recorded so the model is deliberate rather than accidental:

- **The comparison is inclusive.** A notification stamped at the exact instant of an open counts as seen: it was on the list the reader was shown, and an exclusive comparison would leave that one row holding the badge up forever, because no later open can move a watermark past a timestamp it equals.
- **The watermark only moves forward**, enforced in the upsert rather than by the caller. Two devices with disagreeing clocks, or a retry arriving late, must never un-see notifications somebody has already been shown.
- **`markSeen` is deliberately not idempotent**, unlike `notifications.dismiss`, which converges on its first timestamp. "I am looking now" is true of every call, and a converging watermark would freeze at the first open and never clear a badge again. Repeating it is still safe.
- **No outbox event**, matching the dismissal decision and for a stronger version of its reason: opening a panel has no reactor, and an audit entry would durably record every time a person glanced at their own bell.
- **A per-device watermark is a future decision, not a future default.** The primary key is `recipient_id`, so today two devices share one badge — which is the behaviour a person expects from a badge that means "since you last looked", regardless of which screen they last looked at.

---

Escalation threshold for future decisions: addendum §24. Anything touching user experience, trust/privacy model, irreversible data constraints, significant operational cost, or custom infrastructure goes back to the owner.
