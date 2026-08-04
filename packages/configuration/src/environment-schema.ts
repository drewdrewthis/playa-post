import { z } from 'zod';

/**
 * The environment variables every Playa Post runtime understands.
 *
 * Rules for anything added here:
 * - **Never give a secret a default.** A default that works in production is a
 *   secret in source control (addendum §17). Secrets are required and never logged.
 *   The only shape a secret gets validated for is length — enough to fail at boot
 *   rather than at first use, never enough to encode its format here.
 * - **Being non-secret does not earn a default.** A default is right only when every
 *   deployment would want the same value; for anything that identifies an external
 *   system, a wrong-but-plausible default fails silently instead of at boot.
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
   * Base URL of the Supabase project — `https://<project-ref>.supabase.co`.
   *
   * **Required and deliberately undefaulted, though it is not a secret.** Composition
   * derives the project's JWKS endpoint from it and verifies every access token against
   * the keys published there (ADR-0011), so this string decides *whose* users this
   * server accepts. A default would point a misconfigured deployment at some other
   * project and let that project's users in — a failure that presents as a working
   * login, which is the worst shape available.
   *
   * No protocol constraint, deliberately: the local stack `pnpm db:start` boots is
   * served over plain `http`, and pinning `https` here would break every developer.
   */
  SUPABASE_URL: z.url(),
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
 * ⚠ **This object carries a secret** — `databaseUrl`. Never log it, never put it in a
 * span attribute, never return it from a procedure. `createLogger`'s field allowlist
 * (`@playa-post/observability`) drops `databaseUrl` because it is not on it — that is a
 * backstop for a mistake, not a licence to make one.
 */
export interface Configuration {
  readonly nodeEnv: ValidatedEnvironment['NODE_ENV'];
  readonly host: string;
  readonly port: number;
  readonly logLevel: ValidatedEnvironment['LOG_LEVEL'];
  /** `postgres://` URI whose user is the least-privileged `app_rw` role (ADR-0002 §2). */
  readonly databaseUrl: string;
  /** Supabase project base URL. Composition derives the JWKS endpoint from it (ADR-0011). */
  readonly supabaseUrl: string;
}
