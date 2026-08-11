# ADR-0007 — Board query DSL: restricted validated grammar

- **Status:** proposed
- **Date:** 2026-07-30
- **Drivers:** PDF §8 "Database and querying", §4 "Board and Views", §5; addendum §18 ("do not invent a query language"), §15; decision D1

## Context

The prototype's board input accepts a compact query language
(`design/Playa Post.dc.html:649` `parseQuery` / `:658` `matchTok`):

```text
type:offer · from:moss · deg:1|2 · trust:>=60 · is:queued|mine · -word negates · "quoted phrase" · bare words search text
```

The PDF constrains this hard: *"Saved Views and Notify Me use a restricted, validated form of an
existing read-only filter grammar over a server-defined authorized resource. User filters may narrow
authorized data but never broaden access. Do not invent a custom query language or accept arbitrary
read-only SQL."* And: *"Search applies only to visible bulletin content, tags, and locations; never
people."*

The tension: the prototype's syntax *is* a small query language. The resolution is that it is a
**fixed-field filter expression**, not a language — no joins, no projections, no user-controlled
structure. That is inside the PDF's "restricted, validated form" allowance, provided we never write a
general parser and never let a filter reach unauthorized rows.

## Decision

**A closed, fixed-field filter grammar, tokenized by one regex, validated by Zod into a typed AST, and
compiled to parameterized SQL that is applied strictly *after* the authorized-bulletins CTE.**

### Grammar (complete — this list is the specification)

```text
query      := term (WS term)*                       # implicit AND, max 16 terms, max 256 chars
term       := ['-'] (field ':' values | phrase | word)
field      := type | from | tag | loc | deg | trust | is
values     := value ('|' value)*                    # alternation within one field = OR, max 6
phrase     := '"' <text, max 64 chars> '"'
```

| Field | Domain | Semantics |
|---|---|---|
| `type:` | the 7 PDF types: `offer request event collab thanks intro update` (D2 — **no `note`**) | enum, validated |
| `from:` | a handle or display-name fragment, resolved **only** against authors already in the viewer's authorized set | author narrowing, never people search. **Filter-then-resolve**: the token is matched against the already-authorized author set; a fragment that matches nobody in that set yields **zero rows**, never a validation error (cross-reference ADR-0002's indistinguishability section and B17). |
| `tag:` | tag slug | exact match |
| `loc:` | location label fragment | substring on the bulletin's location label |
| `deg:` | `1 2 3 …` (integers) | the author's degree *from the viewer*, from the ADR-0004 read model |
| `trust:` | `(>=|<=|>|<|=)?[0-9]{1,3}` plus the literal `unset` | **the viewer's own** trust in the author. Never anyone else's — no other trust value exists in the viewer's data. `trust:unset` is distinct from `trust:0` (PDF §4). |
| `is:` | `mine dismissed reported expiring queued` | viewer-relative state. `queued` is evaluated **client-side only** over the Dexie pending queue — the server has no such state; the server rejects it in a *saved* view or Notify Me query. |
| bare word / phrase | free text | full-text match over **title, body, tags, location only — not author name**. |

`-` negates any term. Unknown **fields**, unknown enum values, malformed syntax, over-length input, or
more than 16 terms → **rejected with a structured validation error naming the offending token**, never
silently ignored. Silently dropping an unparsed term would show the user results they did not ask for
and, in a saved Notify Me query, notify them about the wrong things.

This rejection rule applies to unknown fields and malformed syntax — it does **not** apply to a
well-formed `from:` value that resolves to nobody in the authorized set. That case is deliberately the
one exception: it is filter-then-resolve (see the `from:` row above), and it returns zero rows, never an
error. Rejecting an unresolvable `from:` would make the error a people-existence oracle — it would answer
"does a person named X exist" — which PDF §3/§4 forbid.

### Deliberate deviations from the prototype (both narrow, both privacy-driven)

1. **Bare text does not match author names.** The prototype includes `au.name` in its text haystack
   (`:671`). Combined with a broad enough term set, that is people search through the text channel, which
   the PDF forbids. `from:` covers the legitimate need and is bounded to authorized authors.
2. **`type:note` is not implemented** — private notes are cut from v1 by decision D2.

### Storage and evaluation

Saved views and the Notify Me query store **both** the source text (for round-tripping into the input)
and the **validated AST as JSONB** with an `ast_version`:

```sql
app.saved_views (id, owner_id, name, source_text, ast jsonb, ast_version int, sort, created_at, updated_at, version)
app.notify_me_queries (id primary key, owner_id, source_text, ast jsonb, ast_version int, source_view_id, updated_at, version)
```

Storing the AST means Notify Me evaluation on the outbox path does not re-parse untrusted text on every
event, and a future grammar change is a versioned migration rather than a silent reinterpretation of
saved queries.

⚠ **`app.notify_me_queries` used to read `owner_id primary key` here, and that line was D1** —
"exactly one Notify Me query per user, expressed as a database constraint rather than a convention".
Product decision **D16** ([#172](https://github.com/drewdrewthis/playa-post/issues/172), owner-directed)
reopened the count: a person may notify on several saved views at once. The constraint expressing it is
now `unique nulls not distinct (owner_id, source_view_id)` — one query per (owner, view), plus one
untied query per owner — so it is still the database enforcing the rule, over a set rather than a
singleton. The per-person bound the primary key was also providing (how many queries the evaluator reads
per `BulletinCreated`) moved into `NOTIFY_ME_QUERY_LIMIT_PER_OWNER`; see D16 and ADR-0016's amended D1.

### Compilation

`CompileBoardFilter` turns the AST into a Kysely `WHERE` fragment with bound parameters — no string
interpolation of user input anywhere. It is always composed as:

```sql
WITH authorized AS ( /* app.visible_bulletins(:viewer_id) — ADR-0002/0004 */ )
SELECT … FROM authorized WHERE <compiled filter> ORDER BY <validated sort> LIMIT …
```

The filter can only narrow `authorized`. Structurally, there is no seam through which it could widen —
that property is asserted by ADR-0002 test B10.

Free-text uses a Postgres generated `tsvector` column over title/body/tags/location with a GIN index.

### Reuse

Same AST, same compiler, three consumers: board list, saved views, Notify Me matching. One grammar, one
validator, one compiler — the reuse is the reason this is a fixed grammar and not three ad-hoc filters.

## Alternatives considered

| Alternative | Why not |
|---|---|
| **Structured filter object only (no text syntax)** | Safest, and genuinely tempting. Rejected because the compact query line is settled, demonstrated UX (prototype board + onboarding card at `:571`), and the syntax *is* the product's "search like a local" feel. The AST is the structured object; the text is a serialization of it. |
| **A real parser generator (Peggy/Chevrotain)** | Buys grammar features we have deliberately refused. A single tokenizing regex plus Zod is smaller, faster in `workerd`, and can express nothing dangerous. |
| **Lucene / Elasticsearch query syntax** | A general query language over a general search engine — new infrastructure, a second authorization boundary, and far more grammar than we want to expose. Postgres FTS is sufficient at this scale. |
| **Arbitrary read-only SQL / PostgREST filters** | Explicitly forbidden by the PDF. |
| **Storing only the source text and re-parsing on each event** | Parsing untrusted text on the hot notification path, and grammar changes silently reinterpreting saved queries. |
| **Ignoring unknown tokens (prototype behaviour)** | Broadens results relative to intent, worst in Notify Me where the user is not present to notice. |

## Consequences

- **Positive:** the prototype's UX survives; one grammar serves three features; injection is
  structurally impossible; the whole grammar fits in one table that a reviewer can audit.
- **Negative:** adding a field is a code change (tokenizer enum, Zod schema, compiler branch, tests) —
  intentional friction on the surface most likely to leak.
- **Negative:** `ast_version` migrations are real work when the grammar changes.
- **UX escalation:** the two deviations above are visible to users; see Escalations in the plan.

## Verification

`accepted` when the compiler exists with a golden-file test per grammar row (query text → AST → SQL),
a rejection test per invalid-input class, and B10 green.
