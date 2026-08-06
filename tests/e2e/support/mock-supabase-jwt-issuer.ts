import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import {
  generateSupabaseSigningKeyPair,
  mintSupabaseAsymmetricUserToken,
  type SupabaseSigningKeyPair,
} from '@playa-post/testing';

/**
 * L5's stand-in for the one boundary the vertical-slice e2e is allowed to mock
 * (`m2-lane-briefs.md` §"TDD hand-off shape" — "Mock only at a boundary you cannot
 * cheaply or deterministically call: the Web Push transport and the Supabase Auth
 * JWT issuer").
 *
 * Serves the same JWKS shape a real Supabase project serves at
 * `/auth/v1/.well-known/jwks.json` (`apps/server/src/composition/supabase-jwks-url.ts`),
 * over a real HTTP server on a random port. Pointing `Configuration.supabaseUrl` at
 * this server's `baseUrl` is therefore all `buildAppContainer`'s `createRemoteJWKSet`
 * needs — the server's token-verification code path runs unmodified and unmocked;
 * only the party that issues the keys and signs the tokens is stubbed.
 *
 * Real magic-link email delivery is out of scope for a headless browser run (there is
 * no mailbox to read), so this issuer mints already-valid, already-onboarded-shaped
 * session tokens directly, the way a test double for an email provider would if one
 * existed. The frontend the coder builds still has to accept a session and call the
 * real, unmocked tRPC API with it — nothing about authorization, actor resolution, or
 * onboarding is faked.
 */
export interface MockSupabaseJwtIssuer {
  /** Pass as `Configuration.supabaseUrl`. */
  readonly baseUrl: string;
  readonly signingKey: SupabaseSigningKeyPair;
  /** Mint a valid, currently-signed access token for the given Supabase auth user id. */
  mintAccessToken(authUserId: string): Promise<string>;
  stop(): Promise<void>;
}

export async function startMockSupabaseJwtIssuer(): Promise<MockSupabaseJwtIssuer> {
  const signingKey = await generateSupabaseSigningKeyPair();

  const server: Server = createServer((request, response) => {
    if (request.url === '/auth/v1/.well-known/jwks.json') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ keys: [signingKey.publicJwk] }));
      return;
    }
    response.writeHead(404).end();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    baseUrl,
    signingKey,
    mintAccessToken: (authUserId: string) =>
      mintSupabaseAsymmetricUserToken({ signingKey, role: 'authenticated', subject: authUserId }),
    stop: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}
