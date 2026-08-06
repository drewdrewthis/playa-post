import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * The second (and only other) boundary the vertical-slice e2e is allowed to mock
 * (`m2-lane-briefs.md` §"TDD hand-off shape"). Not wired into `global-setup.ts` yet
 * because `modules/notifications` (L3b-notify) has not merged into this branch's base
 * — step 9, "Notify Me produces a grouped notification for a matching viewer", is
 * currently a legible import-not-found failure for that reason, not a push-delivery
 * one. This stub exists so the coder wiring L3b-notify's `web-push` transport has a
 * real HTTP endpoint to point it at rather than inventing one under time pressure.
 *
 * Records every push payload it receives rather than asserting anything itself —
 * assertions belong in the test that starts this server.
 */
export interface MockWebPushTransport {
  /** Pass as the push service endpoint the `web-push` library sends to. */
  readonly endpointUrl: string;
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

  return {
    endpointUrl: `http://127.0.0.1:${port}`,
    deliveries,
    stop: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}
