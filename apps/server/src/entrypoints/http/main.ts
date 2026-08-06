import { loadServerConfiguration } from '../../composition/config';
import { buildAppContainer } from '../../composition/container';
import { startOutboxDrainerPoller } from '../outbox-drainer/start-outbox-drainer-poller';

import { createHttpServer } from './http-server';

/**
 * Process entrypoint for the HTTP runtime.
 *
 * Composition root → container → server → listen, plus the outbox-drainer poll loop
 * (M2.14). ADR-0006 names "an in-process poller … no cron variant, no second service"
 * for the Node target, so the drainer starts and stops alongside the HTTP server in
 * this same file's own startup sequence rather than in a second `main.ts` — the
 * composition root is still built by a function rather than assembled here, which is
 * what let this file gain a second long-lived task without becoming the place that
 * builds one.
 *
 * This is the process Render starts — `node apps/server/dist/node/main.js`, the bundle
 * `pnpm build:server:node` writes (ADR-0009). It binds `HOST`/`PORT` from
 * configuration, which is why the blueprint sets `HOST=0.0.0.0`: the default
 * `127.0.0.1` is unreachable from outside the container.
 *
 * Configuration is loaded and the container is built **before** the signal handlers
 * are registered, so a missing `DATABASE_URL` or `SUPABASE_URL` exits non-zero within
 * milliseconds, naming the key and never its value (M1-AC10). Neither step opens a
 * socket, so nothing is half-started when it fails. Starting the poller does not
 * change that: it only arms a timer (`start-outbox-drainer-poller.ts`) and the first
 * round fires no earlier than the poll interval after this line runs.
 */
const configuration = loadServerConfiguration();
const container = buildAppContainer(configuration);
const server = createHttpServer(container);
const outboxDrainerPoller = startOutboxDrainerPoller({
  drainer: container.outboxDrainer,
  onError: (error) => server.log.error({ err: error }, 'outbox drain round failed'),
});

/**
 * Stop accepting connections, let in-flight requests finish, release the pool, exit.
 *
 * Render sends `SIGTERM` on **every** deploy and on free-plan spin-down, so this is
 * not a rare path — it is the normal way this process ends, several times a day.
 * Without it the runtime is killed mid-request and the client sees a reset connection
 * rather than a response.
 *
 * `outboxDrainerPoller.stop()` first: it stops scheduling further poll rounds and
 * waits for any in-flight `drainOnce()` to settle before anything downstream touches
 * the pool it reads through. `server.close()` next, then `container.dispose()`:
 * draining the pool while a request — or a drain round — is still using it turns a
 * clean shutdown into failed queries. The order is the reverse of construction, which
 * is the only ordering discipline ADR-0003's two-scope design needs.
 *
 * `once`, not `on`: a second signal during shutdown means "stop harder", and
 * re-entering `close()` would hang instead. Render escalates to `SIGKILL` on its own
 * timeout, which is the correct backstop for a shutdown that stalls.
 */
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  server.log.info({ signal }, 'shutting down');

  try {
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
