import { loadServerConfiguration } from '../../composition/config';

import { createHttpServer } from './http-server';

/**
 * Process entrypoint for the HTTP runtime.
 *
 * Composition root → server → listen. Nothing else belongs in this file; when the
 * outbox drainer entrypoint lands (M2.14) it gets its own `main.ts` beside this
 * one and shares the same composition root.
 *
 * This is the process Render starts — `node apps/server/dist/node/main.js`, the
 * bundle `pnpm build:server:node` writes (ADR-0009). It binds `HOST`/`PORT` from
 * configuration, which is why the blueprint sets `HOST=0.0.0.0`: the default
 * `127.0.0.1` is unreachable from outside the container.
 */
const configuration = loadServerConfiguration();
const server = createHttpServer(configuration);

/**
 * Stop accepting connections, let in-flight requests finish, then exit.
 *
 * Render sends `SIGTERM` on **every** deploy and on free-plan spin-down, so this
 * is not a rare path — it is the normal way this process ends, several times a
 * day. Without it the runtime is killed mid-request and the client sees a reset
 * connection rather than a response.
 *
 * `once`, not `on`: a second signal during shutdown means "stop harder", and
 * re-entering `close()` would hang instead. Render escalates to `SIGKILL` on its
 * own timeout, which is the correct backstop for a shutdown that stalls.
 */
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  server.log.info({ signal }, 'shutting down');

  try {
    await server.close();
    process.exit(0);
  } catch (error) {
    server.log.error({ err: error }, 'shutdown failed');
    process.exit(1);
  }
}

process.once('SIGTERM', (signal) => void shutdown(signal));
process.once('SIGINT', (signal) => void shutdown(signal));

await server.listen({ host: configuration.host, port: configuration.port });
