import { HEALTH_PATH, readHealth } from './health';

/**
 * Cloudflare Workers (workerd) HTTP entrypoint.
 *
 * The Node entrypoint's opposite number. ADR-0001 rule 2 requires **both** server
 * entrypoints to build in CI from day one, "even after a go" — a Cloudflare-only
 * decision that lets the Node entrypoint rot (or the reverse) converts a
 * reversible choice into a one-way door. `pnpm build:server:cloudflare` is that
 * fitness function; it is not dead code.
 *
 * Scope of what this proves today, stated plainly: the entrypoint and the shared
 * health module bundle and run against the workerd target. It does **not** yet
 * prove Kysely, Supavisor, transactions, or Web Push work there — those are the
 * M3 spike's criteria (ADR-0001 S1–S10), and this file grows to meet them then.
 *
 * Uses only Fetch API globals, which exist in both workerd and Node 18+ — which
 * is what lets a plain Vitest unit test drive it with no emulator.
 */
const worker = {
  fetch(request: Request): Response {
    const { pathname } = new URL(request.url);

    if (request.method === 'GET' && pathname === HEALTH_PATH) {
      return Response.json(readHealth());
    }

    return new Response('Not Found', { status: 404 });
  },
};

export default worker;
