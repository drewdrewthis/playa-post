import type { OutboxConsumer as DrainerConsumer } from '../entrypoints/outbox-drainer/outbox-consumer';
import type { OutboxConsumer as ModuleConsumer } from '../modules/notifications/application/outbox-consumer';

/**
 * Present a module's outbox consumer as the one
 * {@link import('../entrypoints/outbox-drainer/outbox-drainer').createOutboxDrainer}
 * accepts.
 *
 * **Why two types exist at all.** A module's `application/` may not import
 * `apps/server/src/entrypoints/` — `no-domain-to-infrastructure` in
 * `.dependency-cruiser.cjs` forbids that edge outright — so a consumer written inside a
 * module has to state the port it implements in its own layer, and the drainer states
 * the port it dispatches through in its. Two declarations of one contract is the shape
 * that rule produces on purpose; the alternative is the module depending on the runtime
 * it happens to be delivered by.
 *
 * **What actually differs, field by field.** The envelope does not: `eventId`,
 * `eventType`, `occurredAt`, `actorId`, `aggregateId`, and `payload` are declared
 * identically on both sides, and the drainer's `OutboxEventRecord` carries one extra
 * field (`attempts` — delivery bookkeeping the module's `OutboxEventRow` docstring
 * deliberately excludes as "none of a consumer's business"). A record is therefore
 * already a valid row, and this function passes it straight through rather than
 * copying it: rebuilding the envelope here would silently drop any field a future
 * ADR-0006 revision adds to both sides.
 *
 * The consumer *port* differs in exactly one respect — the module calls the receipt
 * name `name`, the drainer calls it `consumerName` — and translating that is the whole
 * of this adapter. `modules/audit` reaches the same drainer without one because its
 * handler is built in `persistence/`, which those rules leave free to import an
 * entrypoint type; a consumer that lives in `application/` cannot, and pays for it
 * here, once, in the composition root.
 *
 * @param consumer - A module-declared consumer. Its `handle` is invoked directly, so
 *   the module keeps its own error semantics: a throw still reaches the drainer and
 *   still becomes backoff or a dead letter (ADR-0006).
 */
export function toDrainerConsumer(consumer: ModuleConsumer): DrainerConsumer {
  return {
    consumerName: consumer.name,
    handle: (event) => consumer.handle(event),
  };
}
