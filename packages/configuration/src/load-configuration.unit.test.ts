import { describe, expect, it } from 'vitest';

import { ConfigurationError, loadConfiguration } from './load-configuration';

/**
 * Values for the two keys that have no default. Obvious placeholders on purpose:
 * a realistic-looking credential in a test file is a credential in source control
 * as far as `secret-scan` and a future reader are concerned.
 */
const REQUIRED_ENVIRONMENT = {
  DATABASE_URL: 'postgres://app_rw@localhost:5432/playa_post_test',
  SUPABASE_JWT_SECRET: 'x'.repeat(32),
} as const;

describe('loadConfiguration', () => {
  it('applies defaults for every key that has one', () => {
    const configuration = loadConfiguration({ ...REQUIRED_ENVIRONMENT });

    expect(configuration).toEqual({
      nodeEnv: 'development',
      host: '127.0.0.1',
      port: 3000,
      logLevel: 'info',
      databaseUrl: REQUIRED_ENVIRONMENT.DATABASE_URL,
      supabaseJwtSecret: REQUIRED_ENVIRONMENT.SUPABASE_JWT_SECRET,
    });
  });

  // M1-AC10, non-vacuous from M2 onward: before DATABASE_URL existed there was no key
  // whose absence could fail, so "boot fails naming the missing key" asserted nothing.
  it('fails naming every missing required key, because a secret must never have a default', () => {
    let thrown: unknown;
    try {
      loadConfiguration({});
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ConfigurationError);
    expect((thrown as ConfigurationError).invalidKeys).toEqual([
      'DATABASE_URL',
      'SUPABASE_JWT_SECRET',
    ]);
  });

  it('rejects an HS256 secret too short to sign with, at boot rather than at first request', () => {
    expect(() =>
      loadConfiguration({ ...REQUIRED_ENVIRONMENT, SUPABASE_JWT_SECRET: 'too-short' }),
    ).toThrow(ConfigurationError);
  });

  it('coerces PORT from the string the process actually receives', () => {
    const configuration = loadConfiguration({ ...REQUIRED_ENVIRONMENT, PORT: '8080' });

    expect(configuration.port).toBe(8080);
  });

  it('maps environment variable names onto the consumer-facing shape', () => {
    const configuration = loadConfiguration({
      ...REQUIRED_ENVIRONMENT,
      NODE_ENV: 'production',
      HOST: '0.0.0.0',
      LOG_LEVEL: 'warn',
    });

    expect(configuration).toEqual({
      nodeEnv: 'production',
      host: '0.0.0.0',
      port: 3000,
      logLevel: 'warn',
      databaseUrl: REQUIRED_ENVIRONMENT.DATABASE_URL,
      supabaseJwtSecret: REQUIRED_ENVIRONMENT.SUPABASE_JWT_SECRET,
    });
  });

  it('rejects a malformed value instead of silently falling back to the default', () => {
    expect(() => loadConfiguration({ ...REQUIRED_ENVIRONMENT, PORT: '70000' })).toThrow(
      ConfigurationError,
    );
    expect(() => loadConfiguration({ ...REQUIRED_ENVIRONMENT, NODE_ENV: 'staging' })).toThrow(
      ConfigurationError,
    );
  });

  it('names every offending key once, sorted', () => {
    let thrown: unknown;
    try {
      loadConfiguration({
        ...REQUIRED_ENVIRONMENT,
        PORT: 'not-a-port',
        LOG_LEVEL: 'chatty',
        NODE_ENV: 'staging',
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ConfigurationError);
    expect((thrown as ConfigurationError).invalidKeys).toEqual(['LOG_LEVEL', 'NODE_ENV', 'PORT']);
  });

  it('never echoes the offending value — a bad secret must not reach a log line', () => {
    const secretish = 'postgres://user:hunter2@db.internal:5432/playa';

    let thrown: unknown;
    try {
      loadConfiguration({ ...REQUIRED_ENVIRONMENT, PORT: secretish });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ConfigurationError);
    const message = (thrown as ConfigurationError).message;
    expect(message).toContain('PORT');
    expect(message).not.toContain(secretish);
    expect(message).not.toContain('hunter2');
  });

  // The failure mode this guards is specific: a ConfigurationError that helpfully
  // quotes what it received turns a boot log into a credential dump, and DATABASE_URL
  // is the first key where that would matter.
  it('never echoes a rejected secret value either', () => {
    let thrown: unknown;
    try {
      loadConfiguration({ ...REQUIRED_ENVIRONMENT, SUPABASE_JWT_SECRET: 'short-but-secret' });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ConfigurationError);
    expect((thrown as ConfigurationError).message).toContain('SUPABASE_JWT_SECRET');
    expect((thrown as ConfigurationError).message).not.toContain('short-but-secret');
  });
});
