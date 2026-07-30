# ADR-0005 — Offline sync protocol, idempotency, and conflict rules

- **Status:** proposed
- **Date:** 2026-07-30
- **Drivers:** addendum §14, §13, §21; PDF §4 "Offline", §5 "Blocking", principle 8

## Context

Addendum §14 fixes the mutation envelope and forbids a generic merge algorithm:

```text
mutationId · mutationType · actorId · clientCreatedAt · payload · expectedVersion (when applicable)
```

The server must persist idempotency results so replay does not duplicate effects; conflict handling must
be explicit *per mutation type*; and blocking, deletion, and revoked authorization must beat stale
offline mutations. The UI must show pending, failed, conflicted, and synchronized states.

## Decision

### Transport

One tRPC procedure, `sync.submitMutations`, accepting an ordered batch (max 50) of envelopes.
Not a per-feature offline path: the queue is a cross-cutting concern and belongs to `modules/sync`.
Each envelope is dispatched to the owning module's application service through a registered
**mutation handler** (`MutationType → handler`), so `sync` depends on modules' public application
interfaces and never on their internals (§19).

The response is per-envelope, never batch-fatal:

```text
{ mutationId, outcome: 'applied' | 'replayed' | 'conflict' | 'rejected' | 'expired',
  result?, conflict?: { reason, currentVersion, currentState }, error?: { code, message } }
```

### Idempotency

```sql
app.mutation_results (
  mutation_id   uuid primary key,          -- client-generated (UUID v7 for k-sortability)
  actor_id      uuid not null,
  mutation_type text not null,
  request_hash  text not null,             -- sha256 of canonical payload
  outcome       text not null,
  result        jsonb,
  created_at    timestamptz not null default now()
)
```

- The row is written **inside the same transaction** as the effect and the outbox event. One commit:
  state + outbox + idempotency record. This is the whole mechanism — there is no second bookkeeping path.
- Replay with the same `mutation_id` **and** matching `request_hash` → return the stored result with
  `outcome: 'replayed'`. Same ID, **different** hash → `rejected` / `IDEMPOTENCY_KEY_REUSE`
  (a client bug or an attack; never silently apply the second one).
- `mutation_id` is client-generated but namespaced by `actor_id` in every lookup, so one actor cannot
  probe or collide with another's mutation IDs.
- **Retention: 30 days.** A mutation arriving with `clientCreatedAt` older than 30 days is
  `expired` — refused, surfaced to the user as "this change is too old to sync", never silently applied.
  Without a retention bound, either the table grows forever or replays silently duplicate after pruning.

### Ordering

Client sends per-actor FIFO and does not advance past an unresolved envelope. The server applies a batch
in the order received, stops the *dependency chain* on the first non-applied outcome for that chain
(e.g. `bulletin.update` after a failed `bulletin.create`), and continues with independent envelopes.
Dependent envelopes whose predecessor failed return `rejected` / `PRECONDITION_FAILED`.

### Precedence (hard invariants, evaluated before any handler)

1. **Actorship is checked first.** Every identifier in a mutation payload — `connectionId`, `bulletinId`,
   `invitationId`, `viewId`, `targetUserId`, `connector` — is verified to belong to, or be reachable by,
   the authenticated actor **before the handler runs**. An actor with no relationship to the subject gets
   a structured failure with zero state change and zero outbox rows. The conflict envelope is a leak
   channel: returning `currentVersion`/`currentState` for a resource the actor is not party to would
   disclose a third party's private directional trust through an error path, so actorship is checked
   **before** version comparison, never after. Cross-reference ADR-0002's B13 write-path IDOR matrix.
2. **Erasure wins over everything.** A mutation touching an erased subject → `rejected` / `GONE`.
3. **Blocking wins over pending connection, introduction, bulletin exposure, and notification.**
4. **Revoked authorization wins.** Withdrawn invitations, removed connections, and lost visibility are
   re-checked at apply time, never at enqueue time.
5. A stale mutation must not resurrect archived, deleted, or erased data — handlers check lifecycle
   state, not just row existence.

### Per-mutation-type conflict matrix (v1)

| Mutation type | `expectedVersion` | Conflict rule |
|---|---|---|
| `bulletin.create` | no | Idempotent on `mutationId`. Duplicate → one bulletin, `replayed`. |
| `bulletin.update` | **yes** | Version mismatch → `conflict` with `currentVersion` + `currentState`; client shows both, user picks. Never last-write-wins. |
| `bulletin.archive` | no | Idempotent — already archived → `applied` (terminal, converging). |
| `bulletin.dismiss` | no | Viewer-local, idempotent, converging. |
| `bulletin.report` | no | Idempotent on `mutationId`; a second distinct report of the same bulletin by the same reporter → `applied` no-op (one open report per reporter/bulletin). |
| `connection.invite` | no | Idempotent on `mutationId`. |
| `connection.accept` | no | Invitation withdrawn/expired/revoked → `rejected` / `INVITATION_UNAVAILABLE`. Already accepted → `applied`. Blocked → `rejected` / `BLOCKED`. |
| `connection.remove` | no | Idempotent; already removed → `applied`. |
| `trust.set` | **yes** (per-connection trust version) | Private, single-owner, low-contention — but a stale value silently overwriting a deliberate change is a trust-model error, so mismatch → `conflict`, not overwrite. |
| `block.create` | no | Idempotent, terminal, and takes precedence over every queued envelope involving the blocked party — including ones earlier in the same batch, which are re-evaluated. |
| `view.save` / `notifyMe.update` | **yes** | Mismatch → `conflict`; last saved query is user-visible state, not a merge candidate. |
| `intro.request` | no | Idempotent; connector no longer a direct connection, or permission withdrawn, or blocked → `rejected`. |

New mutation types must add a row here as part of their DoD (§25).

### Client

Dexie stores: `pendingMutations` (envelope + `state`: `pending | inflight | failed | conflicted | synced`
+ `attempts` + `lastError`), `cachedGraph`, `cachedBoard`, `syncMeta`. Optimistic application is local
and reversible. Conflicts surface as a per-item UI state, never a silent revert. On sync, blocked and
erased subjects are purged from all caches before rendering (PDF §5).

## Alternatives considered

| Alternative | Why not |
|---|---|
| **CRDTs / automerge** | Solves concurrent text/structure merging; our conflicts are authorization and lifecycle conflicts, which are not mergeable and must not be. Large dependency, wrong shape. |
| **Last-write-wins on `clientCreatedAt`** | Client clocks are unreliable, and silently discarding a user's edit contradicts principle 8 ("recovers cleanly") and §14's requirement for structured conflicts. |
| **HTTP `Idempotency-Key` header only, no persisted result** | Cannot return the original result on replay, and gives no protection once an in-memory cache evicts. §14 explicitly requires persistence. |
| **One generic merge function across types** | Explicitly forbidden by §14. |
| **Per-module offline endpoints** | Duplicates the envelope, retention, and precedence logic in every module; no single place to enforce the precedence invariants. |
| **Unbounded idempotency retention** | Either unbounded growth or silent post-prune duplication. 30 days with an explicit `expired` outcome makes the boundary visible. |

## Consequences

- **Positive:** replay-safety and conflict semantics are one commit and one table; every rule is
  enumerable and therefore testable; safety invariants are checked in one pre-handler stage.
- **Negative:** the conflict matrix is manual maintenance — that is the intended trade against a magic merge.
- **Negative:** `expectedVersion` requires a `version` column and bump on the affected aggregates.
- **Risk:** clients that lose the Dexie store lose queued mutations. Accepted for v1; the UI must state
  pending state clearly so the loss is not silent.
- **Data constraint:** `mutation_results` is on the write path of every mutation — index and prune it
  (daily cron, part of ADR-0006's scheduled work).

## Verification

`accepted` when the M2 slice replays one mutation successfully (same ID twice → one effect,
second returns `replayed`), and the M5 conflict matrix has one integration test per row above. Every
mutation type in the conflict matrix carries a B13 row (ADR-0002).
