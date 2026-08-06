# ADR-0013 — Bulletin visibility, `BULLETIN_GONE`, and the board grammar's parse/compile split

- **Status:** proposed
- **Date:** 2026-08-06
- **Amends:** [ADR-0002](ADR-0002-authorization-and-visibility-enforcement.md) §10,
  [ADR-0005](ADR-0005-offline-sync-protocol.md)'s `bulletin.archive` row,
  [ADR-0007](ADR-0007-board-query-dsl.md)'s compilation section
- **Drivers:** `docs/engineering/m2-lane-briefs.md` §L3a; M2-AC5 (board half + §6a), M2-AC6,
  M2-AC12, M2-AC13, M2-AC14, M2-AC18, M2-AC19; ADR-0002 B10/B13/B17

## Context

Lane L3a builds `modules/bulletins` and the grammar half of `modules/views`. Eight decisions
surfaced that no existing ADR settles, and each of them is the kind a later lane will copy: the
moderation module (M5) will need the same "gone" vocabulary, saved views and Notify Me will reuse the
same grammar, and every future authorized set will be shaped like `app.visible_bulletins`. They are
recorded together rather than as PR comments, for the reason ADR-0012 gives: the risk is three lanes
inventing three slightly different answers.

## Decision

### 1. `BULLETIN_GONE` is one answer for four situations

`bulletins.getById` raises `BulletinGoneError` — HTTP 404, code `BULLETIN_GONE` — when the bulletin
does not exist, when the viewer is not authorized to see it, and when its author has archived it.
`bulletins.archive` raises the same error when the actor is not the author.

ADR-0002 §10 requires unauthorized and non-existent to be indistinguishable. M2-AC14 asks for
*byte-identical bodies*, and B17 measures it with an empty `diff`. Four errors kept identically worded
is a property that holds until somebody improves one message; **one error class with one message is a
property that cannot stop holding**. The uniformity is therefore the implementation, not a review
obligation — the same discipline `NotConnectedError` and `InvitationUnavailableError` already
establish.

It also satisfies ADR-0005 precedence rule 1 for free. Actorship decides the answer before anything is
read back, so an unrelated actor can never receive a conflict envelope carrying `currentVersion` /
`currentState`.

⚠ The message may never grow a detail. "This bulletin belongs to someone else", an echoed ID, or an
archival date each turn the error back into the existence oracle it exists to close.

### 2. `app.visible_bulletins` projects the author itself; no second, TypeScript-level person read

The function returns `author_disclosure`, `author_display_name`, and `author_handle` alongside the
bulletin, computed inside the same query that composes `app.visible_people`. `modules/bulletins` does
**not** import `GraphModule.visiblePeople` and does not join `app.users`.

ADR-0002 §6a says every person representation is projected through `app.visible_people`'s disclosure
level. Two ways to satisfy that were available: project in SQL, or read the bulletins and then look
their authors up through graph's exported read model. The SQL projection wins on the §6a rule's own
terms — "hidden information must never be sent to the client merely to be concealed by the UI"
(ADR-0004). Below `full`, the identity columns are never selected, so they never leave the database
and no layer above can forget to strip them. The TypeScript join would put a set of unprojected rows
in process memory between the two reads, and correctness would depend on the second read happening.

**Consequence for ADR-0012's Verification item 4:** L3a is the first consumer of
`GraphModule.visiblePeople` and it consumes **nothing**. The exported query's signature is therefore
still untested by contact; the projection it embodies is what this lane reuses, one layer lower.

### 3. Archived is gone through the visibility function, for everyone; retention lives on `listMine`

`app.visible_bulletins` filters `archived_at is null` for every viewer, the author included.
`bulletins.listMine` reads `app.bulletins` directly by `author_id` and returns archived rows with
`archivedAt` set.

M2-AC12 wants both halves — absent from every non-author board, still on the author's own list. The
alternative, an author exemption threaded through the visibility function, makes the one function every
other read composes carry a per-caller exception. `listMine` is the one sanctioned direct read of
`app.bulletins` precisely because its authorized set is *trivially* the actor's own rows: there is no
visibility question to answer and no author card to project.

### 4. The grammar parses in `modules/views/domain`; the compiler emits SQL in `modules/bulletins/persistence`

ADR-0007 describes one `CompileBoardFilter`. It is implemented as two halves in two modules:

- `parseBoardQuery(text) -> BoardQuery` in `modules/views/domain/board-query-grammar.ts` — a total
  function to a validated AST, no SQL.
- `compileBoardFilter(query) -> RawBuilder<SqlBool>` in
  `modules/bulletins/persistence/board-filter.ts` — the AST to a bound-parameter `WHERE` fragment.

The split is forced by two rules pulling the same way and is better than either alone.
`no-domain-to-infrastructure` forbids a `domain/` file from importing Kysely, and
`no-sql-outside-persistence` forbids SQL outside `persistence/`. What falls out is the property B10
needs: the AST is the *entire* interface between user text and the database, and
`BoardQuery` — `{ types: BoardBulletinType[]; text: string[] }` — has nowhere to carry an author, an
ID, a raw fragment, or a boolean structure. A filter cannot widen the authorized set because there is
no shape in which a widening term could be expressed, let alone compiled.

M5's saved views and Notify Me consume the same parser and, when they evaluate against bulletins, the
same compiler. A second consumer that is not bulletins gets its own compiler in its own
`persistence/` — the AST is what is shared, not the SQL.

### 5. `modules/views` publishes a pure-function barrel, not a module factory

`views.module.ts` re-exports the grammar and nothing else. There is no `createViewsModule`, no
repository, and no router.

Every other module's `<name>.module.ts` is a wiring point; this one has nothing to wire, and a router
mounted with no procedure is the placeholder addendum §4 forbids. The barrel still exists — and is what
`modules/bulletins` imports — so the cross-module edge lands on a declared surface rather than on
another module's internals, which is addendum §19's "shared contract with clear ownership". Saved views
(M5) bring a table, procedures, and a real factory; the file becomes one then.

### 6. M2 refuses the grammar features it has not built, naming the token

`from:`, `tag:`, `loc:`, `deg:`, `trust:`, `is:`, negation (`-term`) and quoted phrases are all
**rejected** with `INVALID_BOARD_QUERY` naming the token, exactly as an unknown field is.

ADR-0007:53-56 forbids silently ignoring an unparsed term because it "would show the user results they
did not ask for". Reinterpreting one is the same bug wearing a different hat: `-hammock` read as the
literal word "-hammock" answers a question nobody asked, and the person reading the results cannot tell.
Each of these becomes an accepted shape in M5 by implementing it, not by loosening the refusal.

The `type:` field's vocabulary is ADR-0007's **seven PDF types**, deliberately not the set M2 can
write (`request` alone). `type:offer` is accepted and returns zero rows; `type:note` is refused,
because D2 cut private notes from the product and `note` is never a value rather than an unbuilt one.
Refusing `type:offer` would make the grammar an oracle for what the product has shipped.

### 7. Free text is a stored `tsvector` on `app.bulletins`, over title and body only

`app.bulletins.search_document` is `generated always as (to_tsvector('simple', title || ' ' || body))
stored`, with a GIN index, projected through `app.visible_bulletins` and matched with
`plainto_tsquery` — ADR-0007's own design ("a Postgres generated `tsvector` column ... with a GIN
index"), scoped to the two columns M2 has.

Generated rather than trigger-maintained or application-written: a second writer is a second place for
the index to disagree with the row. `plainto_tsquery` rather than `to_tsquery` because it treats its
input as data — a term containing `&`, `|` or `!` matches those characters instead of becoming a
boolean operator, so a bare word cannot smuggle in structure the parser refused. `simple` rather than
`english` because the corpus is short multilingual camp shorthand where stemming does more harm than
good.

Tags and location join the haystack in M5, when the columns exist. **Author name never does**
(ADR-0007 deviation 1: it would make bare text a people search through the text channel).

### 8. Archiving bumps `version`

ADR-0005's matrix gives `bulletin.archive` `expectedVersion: no`, and M2 compares no version. The
archive statement still increments `version`, so an M5 `bulletin.update` carrying a pre-archive version
conflicts rather than resurrecting an archived bulletin — which is ADR-0005 precedence rule 5 ("a stale
mutation must not resurrect archived, deleted, or erased data") expressed in the column rather than in a
handler that has to remember it. An idempotent second archive updates no row and therefore bumps
nothing.

## Alternatives considered

| Alternative | Why not |
|---|---|
| **Distinct `BULLETIN_NOT_FOUND` / `BULLETIN_FORBIDDEN` / `BULLETIN_ARCHIVED`** | Each pair is an existence oracle, and M2-AC14 asks for byte-identical bodies. Three codes kept identically worded is a property that survives until the first message improvement. |
| **Read bulletins, then project authors through `GraphModule.visiblePeople` in TypeScript** | Puts unprojected author rows in process memory between two reads, so §6a holds only if the second read happens. The SQL projection makes the columns unreachable rather than un-rendered. |
| **An author exemption inside `app.visible_bulletins` so authors see their archived bulletins** | Puts a per-caller exception in the one function every other read composes. `listMine` answers a different question and can answer it directly. |
| **Compiling the filter in `application/`** | `no-domain-to-infrastructure` forbids Kysely there, and `no-sql-outside-persistence` forbids the SQL. Both rules would have to be weakened to allow one convenience. |
| **Putting the grammar in `packages/contracts`** | That package is the web app's import surface and has a promotion rule of its own. The grammar is server-side validation, and the client sends text. |
| **`createViewsModule()` returning an empty router** | The placeholder addendum §4 forbids, and `no-placeholder-layers` fails the build on it. |
| **Silently ignoring `-term` and quoted phrases as literal text** | ADR-0007:53-56's exact prohibition, one step removed: the result set is not what the person asked for and nothing says so. |
| **Restricting `type:` to the types M2 can write** | Makes a refusal disclose the product's roadmap and turns a zero-row answer into an error, which is the opposite of ADR-0002 §10's shape. |
| **`ILIKE '%term%'` over title and body instead of a `tsvector`** | Unindexable, and a different matching semantic from the one ADR-0007 specified and M5's saved views will inherit. |
| **A mocked repository or an injected fault seam for M2-AC6** | Would prove the service calls two methods, not that the database rolls both back. See Verification 3. |

## Consequences

- **Positive:** unauthorized, non-existent, and archived are indistinguishable *by construction*
  rather than by three tests staying in agreement.
- **Positive:** one authorized-bulletin definition, composing one authorized-person definition, both
  in SQL — so a board, a saved view, and a Notify Me evaluation cannot drift apart.
- **Positive:** the board filter's narrow-only property is a property of a type, not of a compiler's
  care.
- **Negative:** `visible-bulletins.sql` is duplicated into its migration, like `visible-people.sql`
  before it. Mitigated by the verbatim-containment assertion, not by discipline.
- **Negative:** an author cannot fetch their own archived bulletin by ID — `listMine` is the only path
  to it. Acceptable while `listMine` is unpaginated; it becomes a real gap the moment it is not, and
  the fix is an author-scoped `getMine`, never an exemption inside the visibility function.
- **Negative:** the seven-type filter vocabulary and the one-type writable set are two lists that must
  stay coherent. They are deliberately not merged (Decision 6), so the coherence is a comment rather
  than a compiler check.
- **Risk / open:** application commands take `actorId` and `viewerId` as `string`, matching every
  `modules/connections` command, while `modules/graph`'s query takes the branded `ViewerId`. The brand
  is still applied at its single sanctioned call site (`authenticatedProcedure`), and B14's fitness rule
  still fails any procedure input carrying a viewer identifier — but the board's application seam is
  weaker than the graph's, and M2-AC15/B12 will have to decide which convention is the system's.
- **Risk / open:** `BULLETIN_TITLE_MAX_LENGTH` (120) and `BULLETIN_BODY_MAX_LENGTH` (4000) are not
  product decisions. They bound an otherwise unbounded write path and give M2-AC18 a stable code;
  the product may want different numbers.

## Verification

`accepted` when:

1. `pnpm test:integration` is green over `modules/bulletins/tests/` — the two migration-shape suites,
   `bulletin-request-lifecycle`, and `board-visibility-query`.
2. `pnpm test:security` is green with **B10, B13, and B17 `live`** in
   `tests/security/b-rows.manifest.json`, and B17's evidence is an empty `diff` of the paired bodies.
3. **M2-AC6's fault injection is confirmed as real.** The suite revokes `INSERT` on
   `app.outbox_events` from `app_rw` immediately before `CreateBulletinService.create`, so the second
   write inside one transaction genuinely fails after the first has executed. This is ratified as the
   mechanism: it is a Postgres-level fault against the shipping code path, and it required no
   production seam — no `injectFault` hook, no test-only branch. A mock would have proven the service
   calls two methods; this proves the database rolls both back.
4. `pnpm boundaries` is green, and `sql-table-ownership` is green over
   `modules/bulletins/persistence/sql/` **with no `"bulletins"` entry in
   `sql-table-ownership-allowlist.json`** — the module reaches only its own table and a sanctioned
   `app.visible_*` call, which is the whole of Decision 2 restated as a fitness rule.
5. The owner rules on the two open risks above, or a later lane does: the `ViewerId` convention at
   M2-AC15/B12, and the content bounds when the product states real ones.
