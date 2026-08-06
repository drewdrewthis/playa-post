import { createTRPCUntypedClient, httpBatchLink } from '@trpc/client';
import type { AnyTRPCRouter } from '@trpc/server';

import type {
  MutationPath,
  ProcedureInput,
  ProcedureOutput,
  QueryPath,
} from '@playa-post/contracts';

/**
 * The one place this app speaks to the server.
 *
 * **Typed solely by `@playa-post/contracts`.** The tRPC client underneath is
 * deliberately *untyped* — `apps/web` may not import `AppRouter`, and re-exporting it
 * through `packages/contracts` would ship every module's private presenter as the
 * public client surface (ADR-0014). What the router actually is stays the server's
 * business; what a client may call is `PlayaPostApi`, and
 * `tests/fitness/contracts-api-parity.fitness.test.ts` fails `pnpm typecheck` if those
 * two ever disagree.
 *
 * `@trpc/client` rather than a hand-written `fetch`: the request encoding, the batch
 * format, and the error envelope are protocol, and addendum §18 gates re-implementing
 * protocol behind an ADR. No component calls `fetch` directly.
 */
export interface PlayaPostClient {
  query<Path extends QueryPath>(
    path: Path,
    input: ProcedureInput<Path>,
  ): Promise<ProcedureOutput<Path>>;
  mutate<Path extends MutationPath>(
    path: Path,
    input: ProcedureInput<Path>,
  ): Promise<ProcedureOutput<Path>>;
}

export interface PlayaPostClientOptions {
  /**
   * Where the procedures live.
   *
   * Relative on purpose: the dev and preview servers proxy `/trpc` to the API
   * (`apps/web/vite.config.ts`), so the browser and the API are same-origin and the
   * server carries no CORS layer for a browser client to depend on.
   */
  readonly url: string;
  /**
   * The current access token, read **per request** rather than captured once.
   *
   * A token refreshed mid-session has to reach the next call without rebuilding the
   * client; a captured string silently keeps sending the expired one.
   */
  accessToken(): string | null;
}

/** Build the app's single API client. */
export function createPlayaPostClient(options: PlayaPostClientOptions): PlayaPostClient {
  const client = createTRPCUntypedClient<AnyTRPCRouter>({
    links: [
      httpBatchLink<AnyTRPCRouter>({
        url: options.url,
        headers: () => {
          const token = options.accessToken();

          // Omitted, never sent empty: a signed-out browser must carry no
          // `Authorization` header at all, which is what makes "anonymous" and
          // "invalid token" two distinguishable outcomes on the server.
          return token === null ? {} : { authorization: `Bearer ${token}` };
        },
      }),
    ],
  });

  return {
    query<Path extends QueryPath>(
      path: Path,
      input: ProcedureInput<Path>,
    ): Promise<ProcedureOutput<Path>> {
      return client.query(path, input) as Promise<ProcedureOutput<Path>>;
    },
    mutate<Path extends MutationPath>(
      path: Path,
      input: ProcedureInput<Path>,
    ): Promise<ProcedureOutput<Path>> {
      return client.mutation(path, input) as Promise<ProcedureOutput<Path>>;
    },
  };
}

/** Read one string field off a tRPC error envelope, or `null` if it is not there. */
function errorEnvelopeField(error: unknown, field: string): string | null {
  if (typeof error !== 'object' || error === null) {
    return null;
  }

  const data: unknown = (error as { data?: unknown }).data;

  if (typeof data !== 'object' || data === null) {
    return null;
  }

  const value: unknown = (data as Record<string, unknown>)[field];

  return typeof value === 'string' ? value : null;
}

/**
 * The tRPC error code behind a rejected call, or `null` when the failure was not the
 * server refusing.
 *
 * ⚠ A dropped connection is **not** an authorization answer. Treating every rejected
 * promise as `UNAUTHORIZED` signs the user out every time they walk into a tunnel,
 * which is precisely the offline behaviour ADR-0005 exists to prevent.
 */
export function procedureErrorCode(error: unknown): string | null {
  return errorEnvelopeField(error, 'code');
}

/**
 * The **application** code a module attached to its failure — `errorFormatter` in
 * `shared/trpc/trpc.ts` copies it onto the envelope as `applicationCode`.
 *
 * This is what lets the onboarding screen render five distinct handle rejections
 * instead of one "something went wrong": the codes are the server's, the copy is this
 * app's.
 */
export function applicationErrorCode(error: unknown): string | null {
  return errorEnvelopeField(error, 'applicationCode');
}
