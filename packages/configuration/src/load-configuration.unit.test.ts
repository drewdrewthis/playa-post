import { describe, expect, it } from 'vitest';

import { ConfigurationError, loadConfiguration } from './load-configuration';

/**
 * Values for the two keys that have no default — `DATABASE_URL`, a secret, and
 * `SUPABASE_URL`, which is not one but must still be stated. Obvious placeholders on
 * purpose: a realistic-looking credential in a test file is a credential in source
 * control as far as `secret-scan` and a future reader are concerned.
 */
const REQUIRED_ENVIRONMENT = {
  DATABASE_URL: 'postgres://app_rw@localhost:5432/playa_post_test',
  SUPABASE_URL: 'https://project-ref.supabase.co',
} as const;

/**
 * The three optional Web Push keys, together — the only way they may be set.
 *
 * Obvious placeholders for the same reason as above: `VAPID_PRIVATE_KEY` is a real
 * secret in a real deployment, and a test fixture that looks like one is a finding.
 */
const VAPID_ENVIRONMENT = {
  VAPID_PUBLIC_KEY: 'a-public-key-that-is-not-real',
  VAPID_PRIVATE_KEY: 'a-private-key-that-is-not-real',
  VAPID_CONTACT: 'mailto:nobody@example.invalid',
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
      supabaseUrl: REQUIRED_ENVIRONMENT.SUPABASE_URL,
      webPush: null,
    });
  });

  // M1-AC10, non-vacuous from M2 onward: before DATABASE_URL existed there was no key
  // whose absence could fail, so "boot fails naming the missing key" asserted nothing.
  it('fails naming every missing required key rather than defaulting its way past one', () => {
    let thrown: unknown;
    try {
      loadConfiguration({});
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ConfigurationError);
    expect((thrown as ConfigurationError).invalidKeys).toEqual(['DATABASE_URL', 'SUPABASE_URL']);
  });

  // `SUPABASE_URL` is not a secret, but it is the string the server derives its JWKS
  // endpoint from (ADR-0011). A malformed one produces a 404 on every verification,
  // and ADR-0011's uniform error makes that indistinguishable from "the token was bad"
  // — so the whole symptom is "all logins fail" with nothing pointing at the cause.
  // Failing at boot with the key named is the only place that diagnosis is cheap.
  it('rejects a Supabase URL that is not a URL, at boot rather than at first request', () => {
    expect(() =>
      loadConfiguration({ ...REQUIRED_ENVIRONMENT, SUPABASE_URL: 'project-ref.supabase.co' }),
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
      supabaseUrl: REQUIRED_ENVIRONMENT.SUPABASE_URL,
      webPush: null,
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
  // quotes what it received turns a boot log into a credential dump. It has to hold on
  // *every* key, not just the ones declared secret — the realistic way a credential
  // reaches a boot log is an operator pasting one into the wrong variable, and the
  // schema cannot tell a mis-pasted service-role key from a malformed URL.
  it('never echoes a rejected value, whichever key it arrived on', () => {
    // An obvious placeholder, not a realistic credential: a string shaped like a real
    // key in a test file is a finding for `secret-scan` and for the next reader.
    const mispasted = 'a-credential-hunter2-pasted-into-the-wrong-variable';

    let thrown: unknown;
    try {
      loadConfiguration({ ...REQUIRED_ENVIRONMENT, SUPABASE_URL: mispasted });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ConfigurationError);
    expect((thrown as ConfigurationError).message).toContain('SUPABASE_URL');
    expect((thrown as ConfigurationError).message).not.toContain(mispasted);
  });

  describe('Web Push configuration', () => {
    it('reports no Web Push at all when none of the three keys is set', () => {
      // The supported, ordinary state: every local checkout and every test harness.
      // `null` rather than a partly-filled object, so the composition root's single
      // check cannot be two-thirds right.
      expect(loadConfiguration({ ...REQUIRED_ENVIRONMENT }).webPush).toBeNull();
    });

    it('groups the three keys into one object when all of them are set', () => {
      const configuration = loadConfiguration({
        ...REQUIRED_ENVIRONMENT,
        ...VAPID_ENVIRONMENT,
      });

      expect(configuration.webPush).toEqual({
        publicKey: VAPID_ENVIRONMENT.VAPID_PUBLIC_KEY,
        privateKey: VAPID_ENVIRONMENT.VAPID_PRIVATE_KEY,
        contact: VAPID_ENVIRONMENT.VAPID_CONTACT,
      });
    });

    /*
     * All-or-none, and the failure has to land at boot. A server that starts with two
     * of three keys cannot sign a push, and the only place that shows up is inside the
     * flush's receipt transaction — as a window that rolls back on every round with
     * nothing naming the cause.
     */
    it('refuses a partial set, naming every key still missing', () => {
      let thrown: unknown;
      try {
        loadConfiguration({
          ...REQUIRED_ENVIRONMENT,
          VAPID_PUBLIC_KEY: VAPID_ENVIRONMENT.VAPID_PUBLIC_KEY,
        });
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(ConfigurationError);
      expect((thrown as ConfigurationError).invalidKeys).toEqual([
        'VAPID_CONTACT',
        'VAPID_PRIVATE_KEY',
      ]);
    });

    it('refuses a set missing only the contact', () => {
      // The likeliest partial set in practice: somebody pastes the generated key pair
      // and never reads the line about RFC 8292 §2.1 needing a contact.
      expect(() =>
        loadConfiguration({
          ...REQUIRED_ENVIRONMENT,
          VAPID_PUBLIC_KEY: VAPID_ENVIRONMENT.VAPID_PUBLIC_KEY,
          VAPID_PRIVATE_KEY: VAPID_ENVIRONMENT.VAPID_PRIVATE_KEY,
        }),
      ).toThrow(ConfigurationError);
    });

    it('never echoes the private key, whichever way the environment is wrong', () => {
      let thrown: unknown;
      try {
        loadConfiguration({
          ...REQUIRED_ENVIRONMENT,
          VAPID_PRIVATE_KEY: VAPID_ENVIRONMENT.VAPID_PRIVATE_KEY,
        });
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(ConfigurationError);
      expect((thrown as ConfigurationError).message).not.toContain(
        VAPID_ENVIRONMENT.VAPID_PRIVATE_KEY,
      );
    });

    it('rejects an empty string, which is how an unset key arrives from a shell', () => {
      // `VAPID_CONTACT=` in a `.env` file is a *present* key with an empty value, not an
      // absent one — so without a length rule it would sail past the all-or-none check
      // and reach `web-push` as an empty VAPID subject.
      expect(() =>
        loadConfiguration({ ...REQUIRED_ENVIRONMENT, ...VAPID_ENVIRONMENT, VAPID_CONTACT: '' }),
      ).toThrow(ConfigurationError);
    });
  });
});
