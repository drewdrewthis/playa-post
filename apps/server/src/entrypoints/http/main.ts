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

await server.listen({ host: configuration.host, port: configuration.port });
