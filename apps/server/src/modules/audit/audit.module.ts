import type { DatabaseConnection } from '@playa-post/database';

import type { OutboxConsumer } from '../../entrypoints/outbox-drainer/outbox-consumer';

import { createRecordAuditEntryHandler } from './persistence/postgres-record-audit-entry-handler';

/** What the composition root has to hand this module. */
export interface AuditModuleDependencies {
  /** Connected as `app_rw` and nothing else (ADR-0002 §2). */
  readonly database: DatabaseConnection;
}

/** What the composition root gets back: the one outbox consumer this module owns. */
export interface AuditModule {
  /**
   * Registered with the outbox drainer (`entrypoints/outbox-drainer/`) alongside
   * every other module's consumers. Audit has no router and no other public surface
   * (plan M2.15, m2-lane-briefs.md §L3b-infra).
   */
  readonly recordAuditEntryConsumer: OutboxConsumer;
}

/**
 * Wire the audit module.
 *
 * **This file is the module's only wiring point, and that is what keeps the boundary
 * rules satisfiable** (mirrors `identity.module.ts`, `connections.module.ts`):
 * `persistence/` may not be reached from outside the module, so the composition root
 * gets back a ready-made {@link OutboxConsumer} without ever learning it is a Postgres
 * implementation.
 *
 * Called once per process from `composition/container.ts`. Constructing it touches no
 * socket: the pool connects lazily, so the whole graph can be built before the
 * database is reachable.
 */
export function createAuditModule(dependencies: AuditModuleDependencies): AuditModule {
  return {
    recordAuditEntryConsumer: createRecordAuditEntryHandler({ database: dependencies.database }),
  };
}
