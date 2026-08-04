import { z } from 'zod';

/**
 * Minimum length of an HS256 signing secret.
 *
 * `jose` refuses an HS256 key shorter than the hash output, and PostgREST refuses a
 * `jwt-secret` shorter than 32 characters. Checking it here is the difference between
 * failing at boot with the key named (M1-AC10) and failing on the first request that
 * carries a token — the second reads as an auth outage, not a misconfiguration.
 */
const HS256_MINIMUM_SECRET_LENGTH = 32;

/**
 * The environment variables every Playa Post runtime understands.
 *
 * Rules for anything added here:
 * - **Never give a secret a default.** A default that works in production is a
 *   secret in source control (addendum §17). Secrets are required and never logged.
 *   The only shape a secret gets validated for is length — enough to fail at boot
 *   rather than at first use, never enough to encode its format here.
 * - Keep the key set to what a runtime actually reads today. An unused key is
 *   an empty abstraction (§4).
 * - Mirror every change in `.env.example`, which lists the same keys with safe
 *   placeholder values.
 */
export const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  /** Levels are pino's, because the HTTP entrypoint's logger is pino (addendum §18). */
  LOG_LEVEL: z
    .enum(['silent', 'fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .default('info'),
  /**
   * `postgres://` URI for the application database.
   *
   * **Required, secret, and deliberately undefaulted.** ADR-0002 §2 puts the entire
   * privilege backstop on this one string: its user must be `app_rw`, the non-owning
   * `NOBYPASSRLS` role. A default pointing at a local database would work on every
   * developer machine and connect production to nothing — and a default naming any
   * other role silently disables `FORCE ROW LEVEL SECURITY` for every query the
   * application makes, which nothing else in the system would notice.
   */
  DATABASE_URL: z.string().min(1),
  /**
   * HS256 secret the Supabase project signs end-user access tokens with.
   *
   * **Required, secret, and deliberately undefaulted.** It is the only thing standing
   * between a forged `sub` claim and a session as any user in the system (ADR-0011,
   * ADR-0002 §5a). Verification-only here: the server never mints a token with it.
   */
  SUPABASE_JWT_SECRET: z.string().min(HS256_MINIMUM_SECRET_LENGTH),
});

/** Raw, validated environment. Prefer {@link Configuration} in consuming code. */
export type ValidatedEnvironment = z.infer<typeof environmentSchema>;

/**
 * The shape consumers actually receive.
 *
 * Deliberately not the raw env: consumers should not care that `logLevel` arrived
 * as `LOG_LEVEL`, and renaming an environment variable should not ripple through
 * application code.
 *
 * ⚠ **This object carries secrets.** Never log it, never put it in a span attribute,
 * never return it from a procedure. `createLogger`'s field allowlist
 * (`@playa-post/observability`) drops `databaseUrl` and `supabaseJwtSecret` because
 * they are not on it — that is a backstop for a mistake, not a licence to make one.
 */
export interface Configuration {
  readonly nodeEnv: ValidatedEnvironment['NODE_ENV'];
  readonly host: string;
  readonly port: number;
  readonly logLevel: ValidatedEnvironment['LOG_LEVEL'];
  /** `postgres://` URI whose user is the least-privileged `app_rw` role (ADR-0002 §2). */
  readonly databaseUrl: string;
  /** HS256 secret Supabase signs user access tokens with. Verification only (ADR-0011). */
  readonly supabaseJwtSecret: string;
}
