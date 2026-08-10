import { loadServerConfiguration } from '../../composition/config';
import { buildAppContainer } from '../../composition/container';
import { startNotificationFlushPoller } from '../notification-flush/start-notification-flush-poller';
import { startOutboxDrainerPoller } from '../outbox-drainer/start-outbox-drainer-poller';

import { createHttpServer } from './http-server';

/**
 * Process entrypoint for the HTTP runtime.
 *
 * Composition root → container → server → listen, plus the two background loops
 * ADR-0006 asks for: the outbox-drainer poll (M2.14) and the notification
 * grouping-window flush (M2.11). ADR-0006 names "an in-process poller … no cron
 * variant, no second service" for the Node target, so both start and stop alongside
 * the HTTP server in this same file's own startup sequence rather than in a second
 * `main.ts` — the composition root is still built by a function rather than assembled
 * here, which is what let this file gain its long-lived tasks without becoming the
 * place that builds one.
 *
 * The two are separate loops on separate intervals because they are driven by
 * different things: the drainer reacts to rows arriving, the flush reacts to time
 * passing. The flush is not one of the drainer's consumers, and the drainer is told
 * (`excludedEventTypes`, wired in the container) never to claim the rows the flush
 * owns.
 *
 * ⚠ **The flush loop is conditional.** `container.notificationFlush` is `null` when the
 * wired push transport cannot deliver — which is any deployment without the three
 * `VAPID_*` keys — and a loop whose every round could only throw, roll back, and log is
 * worth less than the noise it makes. So this file starts it only when there is
 * something to deliver through, and **logs the skip on the way past**: an
 * unscheduled background task that says nothing is indistinguishable from one somebody
 * forgot to wire, which is exactly the review blocker the drainer hit in PR #28. The
 * flush is fully wired either way; only the timer is conditional.
 *
 * Nothing is dropped while it is skipped. The drainer and `EvaluateNotifyMeHandler`
 * still run, so matches are still computed and written as `pending` rows; grouped
 * windows accumulate and the first flush to run delivers them.
 *
 * This is the process Render starts — `node apps/server/dist/node/main.js`, the bundle
 * `pnpm build:server:node` writes (ADR-0009). It binds `HOST`/`PORT` from
 * configuration, which is why the blueprint sets `HOST=0.0.0.0`: the default
 * `127.0.0.1` is unreachable from outside the container.
 *
 * Configuration is loaded and the container is built **before** the signal handlers
 * are registered, so a missing `DATABASE_URL` or `SUPABASE_URL` exits non-zero within
 * milliseconds, naming the key and never its value (M1-AC10). Neither step opens a
 * socket, so nothing is half-started when it fails. Starting the pollers does not
 * change that: each only arms a timer and its first round fires no earlier than that
 * loop's interval after this line runs.
 */
const configuration = loadServerConfiguration();
const container = buildAppContainer(configuration);
const server = createHttpServer(container);
const outboxDrainerPoller = startOutboxDrainerPoller({
  drainer: container.outboxDrainer,
  onError: (error) => server.log.error({ err: error }, 'outbox drain round failed'),
});
const notificationFlushPoller =
  container.notificationFlush === null
    ? null
    : startNotificationFlushPoller({
        flusher: container.notificationFlush,
        onError: (error) =>
          server.log.error({ err: error }, 'notification flush round failed'),
      });

if (notificationFlushPoller === null) {
  // Logged at startup, every boot, so the skipped loop is a visible decision rather
  // than something a reader has to infer from its absence — see this file's docstring.
  server.log.info(
    'push transport unconfigured — notification flush not scheduled; grouped windows accumulate until VAPID lands',
  );
}

/**
 * Stop accepting connections, let in-flight requests finish, release the pool, exit.
 *
 * Render sends `SIGTERM` on **every** deploy and on free-plan spin-down, so this is
 * not a rare path — it is the normal way this process ends, several times a day.
 * Without it the runtime is killed mid-request and the client sees a reset connection
 * rather than a response.
 *
 * Both pollers stop first: each stops scheduling further rounds and waits for its own
 * in-flight round to settle before anything downstream touches the pool it works
 * through. `server.close()` next, then `container.dispose()`: draining the pool while a
 * request — or a drain round, or a flush mid-transaction — is still using it turns a
 * clean shutdown into failed queries. The order is the reverse of construction, which
 * is the only ordering discipline ADR-0003's two-scope design needs.
 *
 * The pollers are stopped sequentially rather than concurrently, and the flush goes
 * first only because it was constructed last — `?.`, because it may never have been
 * started at all (see above), and a skipped loop has nothing to stop. They share no
 * state: a flush claims its windows by inserting receipts and a half-finished round
 * rolls back whole, so stopping either one first is safe — and a flush interrupted
 * before it ran is simply retried by the next process, because its rows are still
 * `pending`.
 *
 * `once`, not `on`: a second signal during shutdown means "stop harder", and
 * re-entering `close()` would hang instead. Render escalates to `SIGKILL` on its own
 * timeout, which is the correct backstop for a shutdown that stalls.
 */
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  server.log.info({ signal }, 'shutting down');

  try {
    await notificationFlushPoller?.stop();
    await outboxDrainerPoller.stop();
    await server.close();
    await container.dispose();
    process.exit(0);
  } catch (error) {
    server.log.error({ err: error }, 'shutdown failed');
    process.exit(1);
  }
}

process.once('SIGTERM', (signal) => void shutdown(signal));
process.once('SIGINT', (signal) => void shutdown(signal));

await server.listen({ host: configuration.host, port: configuration.port });
