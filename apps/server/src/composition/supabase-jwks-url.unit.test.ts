import { describe, expect, it } from 'vitest';

import { supabaseJwksUrl } from './supabase-jwks-url';

/**
 * Every failure here is invisible at runtime: a wrong URL 404s, every verification
 * throws, and ADR-0011's uniform error message hides which check said so. The
 * misconfiguration presents as "nobody can log in" — so the assertions have to be here,
 * where the string is still readable.
 */
describe('supabaseJwksUrl', () => {
  it('points at the endpoint Supabase Auth publishes a project’s keys on', () => {
    expect(supabaseJwksUrl('https://abcdef.supabase.co').href).toBe(
      'https://abcdef.supabase.co/auth/v1/.well-known/jwks.json',
    );
  });

  it('tolerates the trailing slash an operator copies out of the dashboard', () => {
    // Naive concatenation yields `//auth/v1/...`, which is a different path and a 404.
    expect(supabaseJwksUrl('https://abcdef.supabase.co/').href).toBe(
      'https://abcdef.supabase.co/auth/v1/.well-known/jwks.json',
    );
  });

  it('keeps a base path rather than resolving against the origin', () => {
    // `new URL(path, base)` would drop `/gateway` here. The local stack and any
    // reverse proxy in front of Supabase are the cases where that matters.
    expect(supabaseJwksUrl('http://127.0.0.1:54321/gateway').href).toBe(
      'http://127.0.0.1:54321/gateway/auth/v1/.well-known/jwks.json',
    );
  });

  it('accepts the plain-http URL the local Supabase stack serves', () => {
    expect(supabaseJwksUrl('http://127.0.0.1:54321').href).toBe(
      'http://127.0.0.1:54321/auth/v1/.well-known/jwks.json',
    );
  });

  it('throws on a string that is not a URL rather than building a nonsense endpoint', () => {
    expect(() => supabaseJwksUrl('abcdef.supabase.co')).toThrow();
  });
});
