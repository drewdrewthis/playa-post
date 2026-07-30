# Architecture and Repository Structure Addendum

> Normative. Supplied by the product owner 2026-07-30. Where this addendum conflicts with a looser interpretation elsewhere in the handoff (docs/Burner_Trust_Network_Final_Handoff.pdf), this addendum takes precedence.

This addendum is normative. It clarifies the concrete architecture, package boundaries, repository structure, and implementation rules for the production build.
Where this addendum conflicts with a looser interpretation elsewhere in the handoff, this addendum takes precedence.

## 1. Architectural Style

Build the system as a feature-oriented modular monolith.
The system may have multiple runtime entrypoints, such as an HTTP API, queue consumer, and scheduled worker, but these entrypoints must compose and invoke the same application modules.
Do not create microservices.
Do not organize the server primarily around technical categories such as one global `controllers`, `services`, or `repositories` directory.
Organize code around product capabilities:

* Identity
* Connections
* Graph
* Bulletins
* Views
* Notifications
* Moderation
* Offline synchronization
* Storage
* Audit

Each feature owns its behavior, domain concepts, persistence implementation, transport bindings, and tests.

## 2. Required Dependency Direction

The primary request path is:

```text
tRPC procedure
→ application service
→ domain behavior or policy
→ repository abstraction
→ PostgreSQL
```

The allowed dependency direction is:

```text
Transport
→ Application
→ Domain
← Infrastructure
```

Infrastructure implements interfaces defined closer to the domain or application layer.
The domain must not import:

* tRPC
* React
* Kysely
* Supabase clients
* Cloudflare APIs
* Railway APIs
* HTTP request types
* Database row types
* Logging implementations

The application layer must not depend on transport-specific request or response objects.
Transport code must not directly access repositories or the database.
Repositories must not contain product workflows or authorization decisions that belong in application services or domain policies.

## 3. Repository Structure

Use the following structure as the default:

```text
/
├── README.md
├── CLAUDE.md
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
│
├── apps/
│   ├── web/
│   │   └── src/
│   │       ├── app/
│   │       │   ├── router/
│   │       │   ├── providers/
│   │       │   └── shell/
│   │       │
│   │       ├── features/
│   │       │   ├── identity/
│   │       │   ├── connections/
│   │       │   ├── graph/
│   │       │   ├── bulletins/
│   │       │   ├── views/
│   │       │   ├── notifications/
│   │       │   ├── moderation/
│   │       │   └── sync/
│   │       │
│   │       ├── shared/
│   │       │   ├── components/
│   │       │   ├── hooks/
│   │       │   ├── lib/
│   │       │   └── styles/
│   │       │
│   │       └── entry.tsx
│   │
│   └── server/
│       └── src/
│           ├── composition/
│           │   ├── container.ts
│           │   ├── registrations.ts
│           │   └── config.ts
│           │
│           ├── entrypoints/
│           │   ├── http/
│           │   ├── queue/
│           │   └── cron/
│           │
│           ├── modules/
│           │   ├── identity/
│           │   ├── connections/
│           │   ├── graph/
│           │   ├── bulletins/
│           │   ├── views/
│           │   ├── notifications/
│           │   ├── moderation/
│           │   ├── sync/
│           │   ├── storage/
│           │   └── audit/
│           │
│           └── shared/
│               ├── auth/
│               ├── events/
│               ├── errors/
│               ├── logging/
│               └── transactions/
│
├── packages/
│   ├── contracts/
│   ├── database/
│   ├── observability/
│   ├── configuration/
│   └── testing/
│
├── supabase/
│   ├── migrations/
│   ├── sql/
│   ├── seed/
│   └── tests/
│
├── docs/
│   ├── product/
│   ├── engineering/
│   ├── adr/
│   └── procedures/
│
└── scripts/
```

Do not create a package merely because code could theoretically be shared.
Keep code inside its owning application or feature until a real, demonstrated cross-runtime dependency exists.

## 4. Server Module Structure

Every substantial backend module should follow this shape:

```text
modules/bulletins/
├── transport/
│   ├── bulletins.router.ts
│   ├── bulletin.input.ts
│   └── bulletin.presenter.ts
│
├── application/
│   ├── create-bulletin.service.ts
│   ├── update-bulletin.service.ts
│   ├── archive-bulletin.service.ts
│   ├── report-bulletin.service.ts
│   └── list-visible-bulletins.query.ts
│
├── domain/
│   ├── bulletin.ts
│   ├── bulletin-types.ts
│   ├── bulletin-visibility.policy.ts
│   ├── bulletin.events.ts
│   ├── bulletin.errors.ts
│   └── bulletin.repository.ts
│
├── persistence/
│   ├── postgres-bulletin.repository.ts
│   ├── bulletin.mapper.ts
│   └── sql/
│       └── list-visible-bulletins.sql
│
├── tests/
│   ├── application/
│   ├── domain/
│   └── integration/
│
└── bulletin.module.ts
```

Not every module needs every directory.
Do not create empty abstractions or placeholder layers. Use this structure when the feature has enough behavior to justify it.
Small features may begin with fewer files and split as responsibilities become distinct.

## 5. Single Responsibility Principle

SRP is mandatory at every level.
A class, module, function, or component must have one coherent reason to change.
Examples:

* A tRPC procedure validates transport input, resolves the authenticated actor, invokes one application operation, and maps the result.
* An application service coordinates one use case.
* A domain policy answers one domain question.
* A repository persists or retrieves one category of domain data.
* A mapper converts between persistence and domain representations.
* A notification handler reacts to one event type or one closely related event family.
* A React component should not simultaneously fetch data, implement complex business rules, perform graph layout, and render presentation.

Do not interpret SRP as "every file must be tiny."
Cohesion matters more than file length.
Split code when responsibilities change independently, not merely when a file reaches an arbitrary number of lines.

## 6. Application Services

Application services are classes instantiated through constructor injection.
Each service should represent one explicit use case, for example:

```text
AcceptConnection
SetConnectionTrust
CreateBulletin
ArchiveBulletin
ReportBulletin
BlockUser
SaveBoardView
UpdateNotifyMeQuery
ReplayOfflineMutation
```

An application service may:

* Authorize the action.
* Load required domain state.
* Invoke domain behavior.
* Coordinate repositories.
* Open a transaction.
* Write outbox events.
* Return an application result.

An application service must not:

* Parse HTTP requests.
* Return tRPC-specific response types.
* Render UI representations.
* Resolve dependencies from a container.
* Send asynchronous side effects before the transaction commits.
* Contain unrelated use cases.

## 7. Domain Layer

Use domain objects and policies where they make behavior clearer.
Do not force every database table into a rich domain entity.
This project uses pragmatic DDD, not ceremonial DDD.
Use domain types for behavior such as:

* Connection lifecycle
* Directional trust
* Bulletin lifecycle
* Visibility decisions
* Blocking invariants
* Introduction eligibility
* Report state
* Offline mutation conflict rules

Use plain read models for complex queries such as:

* Visible graph projections
* Board feeds
* Saved-view results
* Notification summaries
* Audit views

Do not reconstruct large aggregate graphs merely to answer read-only queries.

## 8. CQRS-Lite

Use CQRS-lite within the modular monolith.
Commands:

* Change state.
* Run through application services.
* Enforce invariants.
* Use transactions.
* Emit domain or integration events through the outbox.

Queries:

* Do not mutate state.
* May use dedicated query classes or read repositories.
* May return purpose-built read models.
* May use optimized SQL directly.
* Do not require full domain entity reconstruction.

This does not imply:

* Separate databases
* Event sourcing
* Distributed services
* A custom command bus
* A custom query framework

Do not build those.

## 9. Repository Rules

Repository interfaces belong in the domain or application side of their owning module.
PostgreSQL implementations belong in that module's persistence directory.
Use focused repositories. Avoid a generic base repository.
Do not introduce abstractions such as:

```text
GenericRepository<T>
BaseCrudService<T>
UniversalEntityStore
```

unless there is a proven and repeated need that cannot be handled more clearly with explicit code.
Repositories may expose methods designed around use cases:

```text
findActiveById
save
archive
listVisibleForViewer
claimPendingOutboxEvents
```

They do not need to resemble generic CRUD.
All SQL must live in:

* A repository implementation
* A dedicated query implementation
* A checked-in SQL file
* A migration

SQL must not appear in routers, React code, application services, or event handlers.

## 10. Transactions

Transactions are controlled by the application layer.
Required state changes and their outbox events must commit atomically.
Use an explicit transaction abstraction that allows repositories participating in the same use case to share one transaction.
Do not hide transaction boundaries inside individual repository methods when the use case spans multiple writes.
Do not hold transactions open while:

* Calling external APIs
* Sending push notifications
* Uploading files
* Waiting on queues
* Performing slow, unrelated computation

## 11. Events and Transactional Outbox

Events describe facts that have occurred.
Examples:

```text
ConnectionAccepted
ConnectionTrustChanged
UserBlocked
BulletinCreated
BulletinUpdated
BulletinArchived
BulletinReported
BoardViewSaved
NotifyMeQueryChanged
```

The state change and outbox record must be written in one database transaction.
After commit, asynchronous consumers may:

* Evaluate notifications
* Send Web Push
* Invalidate caches
* Update read projections
* Record audit entries
* Run non-critical integrations

Consumers must be:

* Idempotent
* Retryable
* Safe under at-least-once delivery
* Explicit about failure handling

Do not build a custom event framework.
Use a small event envelope with:

```text
eventId
eventType
eventVersion
occurredAt
actorId
aggregateId
payload
```

Add fields only when a concrete need appears.

## 12. Dependency Injection

Use constructor injection.
Use one composition root.
Awilix may be used if it passes the selected runtime compatibility spike. Otherwise use another mature DI library or explicit factory composition.
The following is forbidden inside business code:

```text
container.resolve(...)
getService(...)
globalServices.foo
ServiceLocator.current
```

Only entrypoint and composition code may know about the container.
Prefer explicit dependency types.
Use request scopes only for genuinely request-scoped concerns such as:

* Authenticated actor
* Request correlation ID
* Transaction context when appropriate
* Request logger context

Do not make ordinary stateless services request-scoped without reason.

## 13. Frontend Architecture

The frontend is feature-oriented.
A frontend feature may contain:

```text
features/bulletins/
├── api/
├── components/
├── hooks/
├── model/
├── routes/
├── state/
└── tests/
```

Frontend business rules that affect security or visibility must also be enforced on the server.
The client may hide or disable actions for usability, but client checks are never authoritative.
Use TanStack Query through tRPC for server state.
Use local component state for local UI concerns.
Use a dedicated offline store, likely Dexie over IndexedDB, for:

* Cached graph data
* Cached board data
* Pending mutations
* Sync metadata

Do not introduce a global state library unless the actual application demonstrates a need that server state, URL state, feature state, and local component state cannot satisfy cleanly.

## 14. Offline Synchronization

Offline mutations require:

```text
mutationId
mutationType
actorId
clientCreatedAt
payload
expectedVersion when applicable
```

The server must persist idempotency results so replaying the same mutation does not duplicate effects.
Conflict handling must be explicit per mutation type.
Do not create one magical generic merge algorithm.
Examples:

* Creating the same bulletin twice with the same mutation ID produces one bulletin.
* Updating a stale bulletin version returns a structured conflict.
* A pending connection acceptance must fail cleanly if the invitation was withdrawn.
* A block takes precedence over pending connection or introduction actions.
* A stale mutation must not resurrect archived or erased data.

The UI must expose pending, failed, conflicted, and synchronized states.

## 15. Authorization and Visibility

Authentication identifies the actor.
Authorization determines what the actor may do or see.
Visibility must be enforced before data leaves the server or database.
Never return hidden data and rely on the frontend to conceal it.
Centralize reusable authorization and visibility rules in explicit policies or database functions.
Do not duplicate subtly different visibility logic across routers.
The precise database enforcement strategy may combine:

* Least-privileged application roles
* RLS
* Security-invoker views
* Explicit PostgreSQL functions
* Service-side authorization

The final approach must be documented in an ADR and tested against bypass scenarios.
Do not assume a shared privileged database connection automatically carries the authenticated Supabase user context.

## 16. Moderation

Moderation is a first-class module.
For v1:

* A user may privately report a specific bulletin.
* Reporting immediately hides that bulletin for the reporter.
* A user may separately hide the author, disconnect, or block.
* Reports are not public.
* Reports do not create a user-visible strike count.
* Reports do not automatically alter visibility for other viewers.
* Viewer-controlled visibility remains authoritative.
* Operators may review private reports and intervene when required.
* Reported users are not shown the reporter's identity.
* Serious abuse may result in bulletin removal, posting suspension, or account suspension through an operator action.

A report should minimally contain:

```text
id
reporterId
bulletinId
authorId
reason
createdAt
withdrawnAt
status
```

Keep moderation notes minimal in v1.
Do not build:

* Community juries
* Public reputation scores
* Automated global punishment
* Appeals workflows
* Complex report-weighting algorithms

until demonstrated need exists.

## 17. Encryption and Data Protection

Bulletins are not end-to-end encrypted.
The server is allowed to read bulletin content because it must:

* Enforce visibility
* Search and filter
* Match saved views and Notify Me
* Generate notifications
* Support synchronization
* Support abuse review
* Expire and archive content

Do not claim that the platform cannot access bulletin content.
The v1 security baseline is:

* TLS for all network traffic
* Platform-managed encryption at rest
* Private storage buckets
* Secrets stored in platform secret management
* No secrets in source control
* No bulletin content or private contact information in routine logs
* Server-side authorization
* Least-privileged credentials
* Correct deletion and erasure behavior

Do not add application-level field encryption, envelope encryption, KMS integration, or custom key rotation in v1 unless a specific compliance or threat requirement appears.
Minimize sensitive data instead of building unnecessary cryptography.
Do not duplicate Supabase Auth email data into application tables unless a concrete use case requires it.

## 18. Hardened Libraries Over Improvisation

Use established libraries and platform capabilities before writing custom infrastructure.
Preferred categories include:

* tRPC for typed application transport
* Zod for runtime validation
* Kysely for typed SQL
* Supabase Auth, Postgres, and Storage
* TanStack Query for server state
* Dexie for IndexedDB
* Workbox or a mature PWA integration
* Vitest for unit and integration tests
* Playwright for browser tests
* Testcontainers where real infrastructure is required
* A mature structured logger
* A mature dependency-boundary tool
* A mature DI library if DI is not handled explicitly

Do not build custom versions of:

* A router
* A DI framework
* An ORM
* A migration system
* A validation library
* An event bus framework
* An offline database
* A logging framework
* A job queue
* A test runner
* A query language
* A cryptography layer

Any exception requires an ADR explaining:

* Why existing solutions are insufficient
* Which alternatives were considered
* What long-term maintenance cost is being accepted

## 19. Import and Module Boundary Rules

A module may import:

* Its own internal files
* Stable shared infrastructure
* Public contracts explicitly exported by another module

A module must not import another module's:

* Persistence implementation
* Internal domain entity
* Private service
* SQL
* Test helper
* Internal transport schema

Cross-module interaction should happen through:

* A small public application interface
* A published domain or integration event
* A shared contract with clear ownership
* A coordinated application service when synchronous consistency is required

Avoid circular module dependencies.
Enforce boundaries with ESLint or dependency-cruiser.
At minimum, automated checks must prevent:

* Domain importing infrastructure
* Application importing transport
* Transport importing persistence directly
* Web importing server internals
* Cross-module persistence imports

## 20. Naming Rules

Name classes and files by behavior, not vague technical roles.
Good:

```text
CreateBulletinService
AcceptConnectionService
BulletinVisibilityPolicy
PostgresBulletinRepository
ListVisibleBulletinsQuery
SendGroupedPushHandler
```

Avoid:

```text
BulletinManager
CommonService
Helper
Utils
DataService
Processor
Handler
```

unless the name accurately communicates a narrow responsibility.
Commands should use imperative names.
Events should use past tense.
Queries should describe the data returned.
Boolean functions should read as questions.

## 21. Testing Strategy

Test behavior at the narrowest useful level.
Domain tests cover:

* State transitions
* Invariants
* Policies
* Conflict rules

Application tests cover:

* Authorization
* Coordination
* Transaction behavior
* Event creation
* Failure cases

Repository integration tests cover:

* SQL correctness
* Recursive graph behavior
* Visibility
* Transactions
* Concurrency
* Idempotency

End-to-end tests cover critical user flows.
The first mandatory scenario matrix must include:

* Invite and connection acceptance
* Directional trust changes
* Graph visibility
* Hidden identities
* Blocking
* Bulletin visibility
* Bulletin reporting
* Viewer-controlled dismissal and author hiding
* Notify Me matching
* Offline mutation replay
* Event idempotency
* Account erasure

Do not optimize tests around method-call assertions.
Prefer observable behavior and state.

## 22. Deployment Boundary

The architecture must remain deployable in either of these forms without changing domain or application code:

```text
Cloudflare static frontend
+ Cloudflare Worker API
+ Cloudflare Queues
+ Cloudflare Cron
+ Supabase
```

or:

```text
Cloudflare static frontend
+ conventional Node server and worker
+ Supabase
```

Cloudflare compatibility should be proven through a focused spike.
If Cloudflare runtime constraints create meaningful friction with required libraries, transactions, Web Push, or database access, use a conventional Node deployment such as Railway or Hetzner.
The deployment runtime must not determine module boundaries.
Cloudflare-specific or Railway-specific code belongs only in entrypoints and infrastructure adapters.

## 23. First Production Vertical Slice

Implement this flow before broad feature expansion:

```text
User signs in
→ creates or opens an invite
→ another user accepts
→ each user may assign private directional trust
→ graph renders the accepted connection
→ one user creates a Request bulletin
→ an eligible viewer sees it
→ Notify Me may produce a grouped notification
→ the viewer may dismiss or privately report it
→ the author archives it
→ one mutation is replayed successfully from offline state
```

This slice must prove:

* Authentication
* Authorization
* Feature module boundaries
* Transactions
* Outbox events
* Queue or worker processing
* Visibility queries
* Graph projection
* Bulletin lifecycle
* Moderation reporting
* Offline idempotency
* Deployment
* Observability
* Test strategy

Do not build all feature breadth before this slice works end to end.

## 24. Implementation Decision Rule

When this document intentionally leaves a detail open, choose the simplest proven implementation that satisfies:

* Product behavior
* Security
* SOLID
* SRP
* Module boundaries
* Testability
* Operational reliability
* Reasonable expected scale

Do not ask the product owner to decide routine implementation details.
Do raise a decision when it would:

* Change the user experience
* Change the trust or privacy model
* Create irreversible data constraints
* Introduce significant operational cost
* Require custom infrastructure
* Conflict with an existing architectural principle

## 25. Definition of Done for New Features

A feature is not complete until:

* The user-facing behavior is implemented.
* Authorization is enforced server-side.
* Module boundaries are preserved.
* Domain and application responsibilities are separated.
* Persistence is covered by integration tests where relevant.
* Important state changes emit transactional outbox events.
* Offline behavior is defined where applicable.
* Errors are structured and observable.
* Logs do not expose sensitive content.
* Documentation and ADRs are updated when architecture changes.
* The implementation uses proven libraries rather than unnecessary custom infrastructure.
* The code satisfies SOLID, with particular attention to SRP and dependency inversion.
