import { loadServerConfiguration } from '../../composition/config';

import { createHttpServer } from './http-server';

/**
 * Process entrypoint for the HTTP runtime.
 *
 * Composition root → server → listen. Nothing else belongs in this file; when the
 * queue and cron entrypoints land (M3) they get their own `main.ts` beside this
 * one and share the same composition root.
 */
const configuration = loadServerConfiguration();
const server = createHttpServer(configuration);

await server.listen({ host: configuration.host, port: configuration.port });
