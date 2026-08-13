# ADR-0018 — The personal connection link: a permanent address, a request the owner answers, and rotation as the only revocation (amends 0002, 0012)

- **Status:** proposed — executes the owner's ratification of issue #206 (2026-08-12); the
  ratification settled *that* links become permanent, rotatable addresses answered by their
  owner, and everything below is the execution, which the Verification section must prove
- **Date:** 2026-08-13
- **Drivers:** issue #206 and the owner's ratification of it; ADR-0002 §5a (viewer provenance),
  §6a (one person-projection rule), §10 (no user-existence oracle), B11 (person lifecycle
  fails closed); ADR-0012 (the §6a projection's export, and `app.connections`' shape);
  ADR-0017 (the consent inversion, and a decline that reaches nobody); ADR-0006 (outbox);
  ADR-0014 (contract/router parity); PDF §4 (there is no people search)

## Context

Until this ADR, the only way two people became connected was an **invitation**: the owner
minted a token, somebody opened `/i/:token`, and the connection formed. `app.invitations`
stores a bearer credential — holding the token *is* the consent — and it is single-use,
so the link dies the moment it works.

That produced three failures the owner named in #206, and they compound:

1. **The link is spent by the first person who opens it.** A QR on a camp sign, a URL in a
   bio, a link read out at a gathering: every one of those is a *published address*, and
   the invite model answers the first reader and refuses everybody after. The owner's
   workaround was minting a new token per person, which is the feature not existing.
2. **Opening it connects you.** There is no moment where the owner sees who arrived and
   decides. The token holder's tap is the whole ceremony, which means a forwarded link is
   a connection with somebody the owner never chose — and the product's entire trust story
   (ADR-0012, ADR-0017) is that both sides consent.
3. **Revocation is deletion of a thing that is already gone.** A single-use token has
   nothing to revoke after it is used, and nothing worth revoking before.

The obvious repair — "make the token multi-use" — makes (1) better and (2) strictly worse:
a reusable bearer credential is a standing invitation for anybody who ever saw the URL to
connect at will, forever. An "N uses" variant is worse again, because the remaining count
is invisible state the owner has to reason about, and a link that stops working for no
visible reason is indistinguishable from one that was rotated, which is indistinguishable
from a bug.

So the model has to change, not the parameters. Four questions decided the shape.

**1. What is a link, if it is not a key?** If holding the URL no longer grants anything,
then the URL is an *address*: it resolves to "here is who this is, and here is a button
that asks them". Every other property follows — permanence, reusability, and the fact that
publishing it is safe.

**2. What does a stranger see when they open it?** ADR-0002 §6a is categorical: every
person representation is projected through `app.visible_people`, never joined out of
`app.users`. But the opener is by definition somebody the owner is not connected to, and
may have `visible_to_distance = 'first'` — so the owner would be *absent* from the
opener's `app.visible_people`, and the screen would name nobody. This is the same problem
ADR-0017 solved with the consent inversion, arriving through a different door.

**3. What replaces revocation?** Rotation. But rotation only means something if the
retired URL becomes *inert in a way that tells its holder nothing* — and the person most
likely to be holding it is frequently the reason it was rotated. A rotated link that says
"this link was rotated" is a notification to the person you rotated away from.

**4. Where does abuse pressure land?** A permanent public address invites floods, and the
single-use model's answer (the link runs out) is exactly the property being deleted. The
replacement has to bound the damage without ever telling the flooder what bound they hit.

Underneath all four sits the invariant this feature shares with ADR-0017: **a decline must
be invisible to the person declined.** An owner who cannot silently refuse will accept
requests to avoid a confrontation, and then the gate is not a gate.

## Decision

### D1 — A link is an address, not a key: `/c/:slug` names its owner and offers a request

`app.personal_links` holds **one permanent row per user** — `owner_id` is the primary key,
not a surrogate id with a uniqueness constraint beside it, because "you have one personal
link" is the product statement and a table that can hold two rows for one person needs a
rule somewhere deciding which is current.

Opening `/c/:slug` calls **one query and no mutation**: `connections.personalLink.open`.
It returns the owner as a `ConnectionPerson` and a server-computed `viewerState`:

| `viewerState` | What the screen shows |
|---|---|
| `own` | "This is your own link" — no button |
| `connected` | "You are already connected" — no button |
| `requested` | "Request sent" — no button, and **no promise of an answer** |
| `open` | The owner's name and **Send connection request** |

The precedence is fixed at `own` > `connected` > `requested` > `open`, computed in
`opened-personal-link.ts` from three facts the repository returns, so two clients cannot
disagree about which state a viewer is in.

`requested` comes from the server, never from a local flag: a reload would lose a local
one and the person would send a second request the server refuses, which reads as the app
being broken.

The route lives **inside `ProtectedLayout`**. Requesting requires an identity — an
anonymous "send request" has no requester to name — so an unauthenticated arrival takes
the existing sign-in-and-return path rather than a bespoke one.

**Answering question 2:** the owner is projected from *their own*
`app.visible_people(owner_id, 0, 1)` self-projection, joined `LATERAL`. This is ADR-0017's
consent inversion applied to a published address: **publishing your link is consent to be
named to whoever opens it**, and the naming is *projected* rather than asserted, so §6a
holds and there is still no direct join to `app.users` for a person card.

The join is **INNER**, and that is load-bearing: a deactivated owner has no
self-projection, so their link stops resolving with no extra status check to forget
(ADR-0002 B11, fails closed). The same shape names requesters in the owner's inbox — a
requester who deactivates leaves the inbox rather than sitting there as a nameless row.

### D2 — 16 CSPRNG bytes, base64url, not derived from the owner

`PERSONAL_LINK_SLUG_ENTROPY_BYTES = 16` — **half** `INVITE_TOKEN_ENTROPY_BYTES`, and the
difference is the model. A token's entropy is anti-forgery, because holding it *is* the
connection. A slug's entropy only has to defeat enumeration of a live directory, because
holding it gets you a name and a button and the owner still has to say yes. 128 bits, 22
base64url characters.

`generatePersonalLinkSlug(owner, randomToken)` **takes the owner and never reads it**. A
slug derived from the owner's id or handle — hashed, encoded, salted, any of it — would
make every published copy of the URL a standing disclosure of who published it, in a
product whose PDF §4 promises there is no people search. Taking the parameter and ignoring
it puts the guarantee at the call site rather than leaving it an absence a reviewer has to
notice; `invite-token-csprng.fitness.test.ts` now walks this source too.

### D3 — Rotation overwrites the slug in place, and the anti-oracle is structural

One tap mints a fresh CSPRNG slug and **writes it over the old value**. There is no
versioned table, no `revoked_at`, and no row anywhere carrying the retired slug.

**That is the whole anti-oracle argument.** After a rotation, a lookup for the old slug
finds nothing *by construction* — so it returns exactly what a slug that never existed
returns, and there is no filter for a future reader to forget. A versioned table with a
`revoked_at` would make the same property depend on every subsequent query remembering
`where revoked_at is null`, which is the shape ADR-0002 §10 keeps failing on.

`rotated_at` records **that** a rotation happened and when. It deliberately does not record
**what** the old slug was: a retired address kept in a column is a retired address still
sitting in the database, and the owner rotated precisely to be rid of it.

The new slug must also be **unlinkable** to the old one — somebody who saw the previous
URL must not be able to recognise the next one, or rotating announces itself to exactly the
person it exists to shed. A fresh independent draw is what makes that true; anything
derived from the previous slug, from the owner, or from the clock would not be.

**Rotation touches nothing else.** Not connections, not requests already received. It has
one column's worth of effect, `app.connection_requests` carries no `personal_link_id`
(see D4), and a request can be answered normally across a rotation that happened between
the ask and the answer.

### D4 — Requests are their own table: no note, no link reference, one open per pair

`app.connection_requests`, never a second meaning for `app.invitations`. An invitation is
*spent by its holder*; a request is *answered by its recipient*. Different actors,
different terminal states, opposite consent directions — one table means a nullable
`accepted_by_id` meaning "who spent it" on some rows and nothing on others, which is the
placeholder shape addendum §4 refuses.

Status is `pending` → `accepted` | `declined`, with `decided_at` held to it by an equality
CHECK (`(status = 'pending') = (decided_at is null)`), matching ADR-0017's discipline.

**No note field.** ADR-0017's intro requests carry one because the requester is asking a
*third party* to vouch, and a vouch needs words. Here the reader is the person themselves
and the question is "do I know this person" — a free-text field addressed to somebody who
has not consented to hear from you is an unsolicited message channel to a stranger, which
is the thing the connection gate exists to require consent for.

**No `personal_link_id` column.** Rotation must not touch requests already received, and a
foreign key to a row whose slug is overwritten in place would either carry a stale meaning
or invite a cascade. What a request records is that two people are involved; which address
the requester arrived through is not a fact anybody reads back.

**One open request per pair**, as a partial unique index on `(owner_id, requester_id)
where status = 'pending'`. Partial deliberately: a *decided* request leaves the pair free
to ask again, because a decline the requester cannot see must not be a decision they can
never revisit.

### D5 — Abuse control is limits, not use counts — and the TTL is evaluated, never stored

Three limits, all enforced **inside the single gated insert statement** so concurrency
cannot walk past them:

| Limit | Value | Counted over |
|---|---|---|
| Request TTL | `CONNECTION_REQUEST_TTL_DAYS = 14` | `created_at`, at every read and at decide time |
| Pending cap per owner | `PENDING_CONNECTION_REQUEST_CAP = 32` | rows with `status = 'pending'` and not lapsed |
| Rate limit per link | `CONNECTION_REQUEST_RATE_LIMIT = 12` per `CONNECTION_REQUEST_RATE_WINDOW_MINUTES = 60` | **every** status |

The rate window spans every status on purpose: a burst declined as fast as it arrived
still consumed the link's recent budget, or declining is how an attacker resets it and the
owner's own diligence becomes the flood's fuel.

The cap is a **pending** cap, not a total: an owner who answers their inbox is never
blocked, and an owner who does not is not flooded. Lapsed rows do not count, so the cap
cannot become permanent through abandonment.

**There is no `expired` status, and there must not be one.** Expiry is evaluated against
`created_at` by every read and by the gated update, so it needs no writer. A stored state
needs a cron to maintain it and is wrong for exactly as long as that cron is behind — and
"wrong" here means an owner accepting a request the rules say has already gone, which
manufactures a connection out of consent that expired. The floor is computed once per
request in the application layer (`liveRequestFloor(now)`) and bound into the statement, so
the arithmetic has one home and a test can place a request either side of the boundary.
`hasLapsed()` is the second spelling of the SQL predicate, tested against it, boundary-
inclusive to match `created_at > floor`.

> ⚠ **The partial unique index cannot see the TTL, and this nearly shipped as a permanent
> block.** An index predicate must be immutable, so `where status = 'pending' and created_at
> > now() - interval '14 days'` is not a legal index. With a plain `ON CONFLICT DO NOTHING`,
> a fourteen-day-old pending row still conflicts — so the pair is blocked **forever**, which
> is the exact opposite of what an expiry is for. The insert therefore carries a conditional
> refresh arm:
>
> ```sql
> on conflict (owner_id, requester_id) where status = 'pending'
> do update set created_at = excluded.created_at
>    where connection_requests.created_at <= $liveSince
> returning …
> ```
>
> A lapsed row is refreshed in place (one row returned, the ask succeeds); a live one
> updates nothing (zero rows, the ask is refused). Two integration tests hold the two arms
> apart, because a single test of either one passes with the bug present.

**Rejected: the "N uses" link.** It keeps invisible remaining-use state the owner cannot
inspect, it makes a working link and a rotated link indistinguishable to the recipient,
and — decisively — it preserves the auto-connect-for-holder model this whole ADR exists to
retire. Limits bound the damage; use counts bound the *feature*.

### D6 — No requester-side read, and therefore no requester-side index

There is no "requests you have sent" list and no notification of a decline. A requester
learns of an **acceptance** the way an introduced pair does — the edge appears on their
graph — and learns **nothing at all** of a decline, which is indistinguishable from a
request nobody has answered yet.

This is ADR-0017's founding invariant, one relationship along, and it costs the same thing:
somebody refused waits on an answer that will never visibly come. The alternative makes
refusing unsafe, and a gate that cannot safely be closed is not a gate.

`app.connection_requests` carries **no requester-side index** for the same reason. Adding
one would be the first half of building the read that breaks this.

### D7 — Accepting writes `app.connections` in the same transaction

Not through the outbox. `connectAcceptedPair()` writes the connection rows and the
`ConnectionAccepted` outbox event inside the transaction that flips the request to
`accepted`.

**This deliberately differs from ADR-0017 D9**, where an accepted introduction connects on
the outbox drainer's next round. The difference is ownership, not taste: `modules/intros`
does not own `app.connections`, so it *must* hand the write across a module boundary and
the outbox is the sanctioned seam. Here the request and the connection live in the **same
module**, so an event would buy asynchrony nobody asked for and a window in which the owner
has accepted and the graph disagrees. Hence the copy difference too — the request inbox
says "connected" in the past tense, where the intro inbox says "you are being connected".

`ConnectionOrigin` grows a third arm (`{ connectionRequestId }`), joining `invitationId`
and `introRequestId`, and `ConnectionAccepted` carries the request id. The union is closed,
so a reader that forgot the new arm fails to compile rather than silently mis-attributing
an edge.

Both decisions are **gated single statements** — `update … where id = $id and owner_id =
$actor and status = 'pending' and created_at > $liveSince` — so terminality, ownership, and
the TTL are enforced by the statement rather than by a read-then-write the next request can
interleave with.

### D8 — One refusal for everything

`PersonalLinkUnavailableError` (`PERSONAL_LINK_UNAVAILABLE`) and
`ConnectionRequestUnavailableError` (`CONNECTION_REQUEST_UNAVAILABLE`) both map to tRPC
`NOT_FOUND` in `connections.router.ts`'s `asTrpcError`, exactly as `InvitationUnavailableError`
does.

**Every** failed resolution arrives as the same message with no cause named. At the
repository these are seven distinct refusals (Verification row 12): a slug matching no row
— which is what an unknown, malformed, *and* rotated slug all are, since a rotated slug is
stored nowhere (D3) and the wire puts no shape on a slug beyond "string" — a deactivated
owner, a self-request, an already-connected pair, a live duplicate request from the same
pair, an owner at their pending cap, and a link over its rate limit.

The two abuse limits hiding behind it are the ones worth stating aloud. "Not accepting
requests right now" would be an honest code and a leak — it tells anybody holding a public
URL how busy its owner is, and it tells a flooder they found the ceiling. The client-side
copy is asserted to name no cause, including negative assertions against the words
"rotated", "retired", and "expired", because the rotated case is the one that matters and
the client must not invent a distinction the server spent its design refusing to make.

### D9 — The invite model is left entirely alone

No migration touches `app.invitations`. No procedure changes. `/i/:token` behaves exactly
as it did, including its refusals, so links already sitting in somebody's chat history keep
working. The two models coexist; deprecating the older one is a separate decision with its
own migration story, and #206 explicitly did not ask for it.

## Alternatives considered

| Alternative | Why not |
|---|---|
| **Make the invite token multi-use** | Fixes reuse, worsens consent: a standing bearer credential lets anybody who ever saw the URL connect at will, forever. |
| **"N uses" link** | Invisible remaining-use state; a spent link is indistinguishable from a rotated one or a bug; preserves auto-connect-for-holder, the thing #206 exists to retire. |
| **Versioned `personal_links` with `revoked_at`** | Makes the anti-oracle property depend on every future reader remembering a filter, and keeps the retired address in the database the owner rotated to be rid of. |
| **A `personal_link_id` FK on requests** | Couples received requests to a row whose slug is overwritten in place — either a stale meaning or a cascade, and #206 requires rotation to touch neither. |
| **A note field on the request** | An unsolicited free-text channel to somebody who has not consented to hear from you — the exact thing the connection gate requires consent for. |
| **Honest refusal codes for the cap and the rate limit** | Leaks owner activity to anyone holding a public URL, and tells a flooder where the ceiling is. |
| **An `expired` status maintained by a job** | Needs a cron and is wrong for as long as it lags; a lagging job means an owner accepting expired consent. |
| **Connect via the outbox on accept (ADR-0017 D9's shape)** | Same module owns both tables; asynchrony nobody asked for, plus a window where the owner has accepted and the graph disagrees. |
| **A requester-side "sent requests" screen** | Makes a decline visible by its absence, which makes declining unsafe. |
| **`/c/:slug` outside `ProtectedLayout`** | A request needs a requester to name; an anonymous sender has none, and a bespoke sign-in path duplicates one that exists. |

## Consequences

- **`app.connections` now has three writers** — the invite acceptance, the intros outbox
  handler (ADR-0017 D9), and this transaction. `ConnectionOrigin`'s closed union is what
  keeps them distinguishable; a fourth writer that forgets to extend it fails to compile.
- **The permanent link is a permanent attack surface.** A published address cannot be
  un-published, and rotation is the only remedy the owner has. The three limits bound the
  damage per link, and the pending cap bounds it per owner, but somebody determined can
  keep a link at its rate limit indefinitely. What they cannot do is connect, learn
  anything about the owner beyond what the link already discloses, or find out that any
  limit exists.
- **Rotation is destructive and unconfirmed.** One tap and the previous URL is gone from
  every printed sign, every bio, and every chat message it was pasted into — with no undo,
  because the old value is stored nowhere by design (D3). The web surface states the
  consequence before the button and shows the fresh link after; it does not ask twice.
- **A decline is silent and re-askable.** The declined party may ask again immediately —
  the partial index frees the pair on decision — and no cooldown ships with #206. That is
  the same known vector ADR-0017 recorded, with the same reasoning: a cooldown is a product
  decision about *how long*, not a schema gap. The rate limit is what keeps it from being a
  loop.
- **The owner's inbox is now the second thing on the graph screen** that consumes attention
  before the graph itself, above the intro inbox. Both render nothing at all when empty —
  including while their read is in flight — so an idle graph screen is unchanged.
- **The `You` screen no longer mints invites.** `connect-card.tsx` reads the personal link
  instead, so `tests/e2e/support/mint-invite.ts` is replaced by `connect-users.ts` and the
  four specs that bootstrapped two connected users now walk the three-act consent path —
  which makes every one of them **slower and more fragile**, because what used to be one
  page's work is now two pages taking turns. `apps/web/src/app/profile/invite-share.ts` is
  now imported by no app code; it is left in place with its unit test rather than deleted,
  because deleting it is part of retiring the invite model and D9 says that is a separate
  decision.
- **`EXPECTED_PROCEDURE_COUNT` moves 40 → 46** with six procedures, and the contracts spec
  carries six new keys. The parity gate (ADR-0014) has three hand-maintained registries —
  `api-spec.ts`, `inputParity`, `outputParity` — and forgetting any one of them fails.
- **The gated insert and the gated update are Kysely `sql` literals**, so no TypeScript
  rule can inspect the authorization inside them; the integration suite is their only
  cover. `sql-table-ownership` keeps the checked-in escape hatch shut, and this module
  needs no allowlist entry because both tables belong to it.
- **`app.visible_people` is called once per resolution** — once for the owner on every
  link open, once per row on an inbox read. Both run at `max_depth 0, 1` (the
  self-projection), which is the cheapest shape that function takes, but an inbox at the
  32-row cap issues 32 of them in one lateral join.

## Verification

| # | Claim | Evidence |
|---|---|---|
| 1 | Both tables carry the §4 backstop, `app_rw`-only grants, and nothing for `anon`/`authenticated`/`public` | `apps/server/src/modules/connections/tests/integration/personal-links-schema-migration.integration.test.ts` |
| 2 | One row per owner (PK on `owner_id`), a unique slug, and **nowhere to keep a retired slug** | same suite — the column list is asserted exhaustively, so adding `previous_slug` fails |
| 3 | Status is the three states with **no `expired` among them**, and `decided_at` agrees in both directions | same suite |
| 4 | One open request per pair, and a *decided* request frees the pair | same suite |
| 5 | The inbox/cap index and the rate-window index both exist, and there is no requester-side one | same suite |
| 6 | A slug is 16 CSPRNG bytes, base64url, strictly weaker than an invite token, and independent of its owner in both directions | `apps/server/src/modules/connections/tests/domain/personal-link.unit.test.ts`; `tests/fitness/invite-token-csprng.fitness.test.ts` now walks `personal-link.ts` |
| 7 | Two draws never match — a rotation is unrecognisable to whoever held the old link | `apps/server/src/modules/connections/tests/domain/personal-link.unit.test.ts` |
| 8 | The three limits are 14 days / 32 / 12-per-60-minutes, and `hasLapsed` is boundary-inclusive exactly where the SQL predicate is | `apps/server/src/modules/connections/tests/domain/connection-request.policy.unit.test.ts` |
| 9 | The link is minted once and returned unchanged forever, and reading it never rotates it | `apps/server/src/modules/connections/tests/integration/personal-links.integration.test.ts` |
| 10 | A rotated slug is **indistinguishable from one that never existed**, and rotation touches neither existing connections nor already-received requests | same suite |
| 11 | A total stranger is named the owner (the consent inversion), and a deactivated owner's link stops resolving with no extra check | same suite |
| 12 | Seven different send refusals answer identically and leave zero rows behind; four decide refusals do the same | same suite — serialized into a `Set` asserted to hold one element |
| 13 | A lapsed request lets the pair ask again; a live one still refuses — the two arms of the `ON CONFLICT` fix, held apart | same suite, both tests |
| 14 | Accepting writes the connection **in the same transaction**, at an accepted invite's own disclosure; declining connects nobody and announces nothing to the requester | same suite |
| 15 | Deciding is terminal-once under concurrency, unaffected by a rotation in between, and a declined pair may ask again | same suite |
| 16 | Events carry no slug, name the right actor, and refuse to be built from the wrong row | `apps/server/src/modules/connections/tests/domain/connection-request.events.unit.test.ts` |
| 17 | The services hold no authorization and read one clock per call, over fakes rather than mocks | `apps/server/src/modules/connections/tests/unit/personal-link-services.unit.test.ts` |
| 18 | `viewerState` precedence is `own` > `connected` > `requested` > `open` | `apps/server/src/modules/connections/tests/unit/opened-personal-link.unit.test.ts` |
| 19 | The wire refuses a self-named actor and an unknown decision | `apps/server/src/modules/connections/tests/unit/decide-connection-request.input.unit.test.ts` |
| 20 | Contract and router agree at 46 procedures | `tests/fitness/contracts-api-parity.fitness.test.ts` |
| 21 | No new procedure accepts a viewer identifier | `tests/fitness/viewer-id-provenance.fitness.test.ts` |
| 22 | `/c/:slug` calls **no mutation** on open, names the owner, and states that a tap sends a *request* before the button is pressed | `apps/web/src/app/routes/personal-link-open.unit.test.tsx` |
| 23 | A refused link renders one neutral sentence naming no cause — asserted against "rotat", "retire", "expire" | same file |
| 24 | The owner's inbox names the requester, says what each answer does before either is pressed, and uses test ids distinct from the intro inbox's | `apps/web/src/app/connections/connection-request-inbox.unit.test.tsx` |
| 25 | The share blurb carries no link and describes a *request*, not a connection (#160's non-overlap rule) | `apps/web/src/app/profile/personal-link-share.unit.test.ts` |
| 26 | The `You` screen reads the link, copies it, shares it, and rotates it | `apps/web/src/app/profile/connect-card.unit.test.tsx` |
| 27 | Two browsers connect through a personal link end to end — A shares, B asks, A accepts — and the graph agrees afterwards | `tests/e2e/vertical-slice-e2e.spec.ts` steps 2–4, over `tests/e2e/support/connect-users.ts`; three further specs bootstrap through the same helper |
| 28 | The `You` screen shows a real `/c/` link, its promise, and a reachable rotate control | `tests/e2e/you-screen.spec.ts` — the rotate button is asserted and deliberately never pressed, since the run shares one account and a rotation has no undo |
| 29 | **Not proven by any browser walk** — that a rotated link refuses its old URL, and that a decline is silent | integration only (rows 10 and 14). A browser proof of the first needs a spec that rotates a shared account's link mid-run; the second has, by construction, nothing on screen to assert |
