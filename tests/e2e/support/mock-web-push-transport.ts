import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import type {
  PushPayload,
  PushSubscription,
  PushTransport,
} from '../../../apps/server/src/modules/notifications/domain/push-transport';

/**
 * The second (and only other) boundary the vertical-slice e2e is allowed to mock
 * (`m2-lane-briefs.md` §"TDD hand-off shape"). `global-setup.ts` injects `transport`
 * through `buildAppContainer`'s composition-layer override seam (issue #31, option 2),
 * which is what makes `container.notificationFlush` non-null in the e2e server and lets
 * the grouping-window flush be scheduled there.
 *
 * Records every push payload it receives rather than asserting anything itself —
 * assertions belong in the test that starts this server.
 */
export interface MockWebPushTransport {
  /** Pass as the push service endpoint the `web-push` library sends to. */
  readonly endpointUrl: string;
  /**
   * A `PushTransport` that delivers over real HTTP to {@link endpointUrl}, so a flush
   * wired with it exercises the same fail-on-non-2xx contract a `web-push` adapter
   * would. `isConfigured` is omitted on purpose: omitted means configured
   * (`push-transport.ts`), which is what makes the composition root schedule the flush.
   */
  readonly transport: PushTransport;
  readonly deliveries: ReadonlyArray<{ readonly headers: Record<string, string | string[] | undefined>; readonly body: string }>;
  stop(): Promise<void>;
}

export async function startMockWebPushTransport(): Promise<MockWebPushTransport> {
  const deliveries: Array<{ headers: Record<string, string | string[] | undefined>; body: string }> = [];

  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      deliveries.push({ headers: request.headers, body: Buffer.concat(chunks).toString('utf8') });
      response.writeHead(201).end();
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  const endpointUrl = `http://127.0.0.1:${port}`;

  return {
    endpointUrl,
    transport: {
      async send(subscription: PushSubscription, payload: PushPayload): Promise<void> {
        const response = await fetch(subscription.endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!response.ok) {
          // Throwing rolls the receipt back so the window is retried — the same
          // at-least-once contract `PushTransport.send` documents for a real adapter.
          throw new Error(`mock web push endpoint answered ${String(response.status)}`);
        }
      },
    },
    deliveries,
    stop: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}
