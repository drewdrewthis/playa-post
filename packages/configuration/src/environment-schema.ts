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
 *
 * Per-key validation only. A rule spanning two keys belongs on
 * {@link environmentSchema}, which wraps this object with exactly one.
 */
const environmentKeys = z.object({
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
  /**
   * VAPID application server public key — URL-safe base64, and **not a secret**: the
   * browser needs it to subscribe, so `apps/web` ships the same string as
   * `VITE_VAPID_PUBLIC_KEY`. Optional; see {@link VAPID_KEYS}.
   */
  VAPID_PUBLIC_KEY: z.string().min(1).optional(),
  /**
   * VAPID application server private key. **A secret**, and length is the only shape
   * asserted — enough to fail at boot rather than at the first push, never enough to
   * encode its format here. Optional; see {@link VAPID_KEYS}.
   */
  VAPID_PRIVATE_KEY: z.string().min(1).optional(),
  /**
   * The `mailto:` or `https:` URI a push service contacts about this application
   * server, as [RFC 8292](https://www.rfc-editor.org/rfc/rfc8292) §2.1 requires.
   *
   * Unvalidated beyond length on purpose: `web-push` is the authority on the accepted
   * URI forms and rejects a malformed one itself, and a second, stricter rule here
   * would refuse a legitimate contact the day that library widens what it accepts.
   * Optional; see {@link VAPID_KEYS}.
   */
  VAPID_CONTACT: z.string().min(1).optional(),
});

/**
 * The three keys that configure Web Push, which are **all-or-none**.
 *
 * A deployment with one or two of them set is a deployment somebody was in the middle
 * of configuring: `web-push` cannot sign a request without the pair, and a push service
 * refuses one without a contact. Accepting a partial set would boot a server that looks
 * configured and fails at the first delivery — inside the flush's receipt transaction,
 * where the only symptom is a window that rolls back forever.
 *
 * Absent entirely is a first-class, supported state: the composition root wires
 * `unconfiguredPushTransport`, the flush is never scheduled, and matches accumulate as
 * `pending` rows (`modules/notifications/infrastructure/unconfigured-push.transport.ts`).
 */
const VAPID_KEYS = ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_CONTACT'] as const;

/**
 * Everything the environment declares, plus the one cross-key rule it carries.
 *
 * ⚠ **`.check()` and not `.refine()`**, because the error must name *every* missing key
 * rather than one: `ConfigurationError` reports `invalidKeys`, and an operator who has
 * set one of three wants both remaining names in the first boot failure, not the second.
 *
 * ⚠ **Still a `ZodObject`.** Zod 4 keeps refinements inside the schema, so `.shape` and
 * `.safeParse` survive — `tests/fitness/render-blueprint.fitness.test.ts` reads both.
 *
 * The check does not run when a *required* key is also missing (Zod aborts first), so a
 * boot missing `DATABASE_URL` and half a VAPID set reports the database key, then the
 * VAPID keys on the next attempt. Two honest failures rather than one; the alternative
 * is asserting cross-key rules against values that failed their own validation.
 */
export const environmentSchema = environmentKeys.check((context) => {
  const present = VAPID_KEYS.filter((key) => context.value[key] !== undefined);

  if (present.length === 0 || present.length === VAPID_KEYS.length) {
    return;
  }

  for (const key of VAPID_KEYS.filter((candidate) => context.value[candidate] === undefined)) {
    context.issues.push({
      code: 'custom',
      input: context.value,
      path: [key],
      message: `Web Push configuration is all-or-none: set every one of ${VAPID_KEYS.join(', ')}, or none of them.`,
    });
  }
});

/** Raw, validated environment. Prefer {@link Configuration} in consuming code. */
export type ValidatedEnvironment = z.infer<typeof environmentSchema>;

/**
 * The VAPID credentials a Web Push adapter signs with, as one object.
 *
 * Grouped rather than spread across three fields on {@link Configuration} so that
 * "is Web Push configured" is a single `null` check at the one place that asks
 * (`composition/container.ts`), instead of three reads a future edit could get
 * two-thirds right.
 *
 * ⚠ **Carries a secret** — `privateKey`. Same handling as `databaseUrl`: never logged,
 * never in a span attribute, never in a response body.
 */
export interface WebPushConfiguration {
  /** Not a secret: the browser subscribes with this same string. */
  readonly publicKey: string;
  readonly privateKey: string;
  /** `mailto:` or `https:` URI, per RFC 8292 §2.1. */
  readonly contact: string;
}

/**
 * The shape consumers actually receive.
 *
 * Deliberately not the raw env: consumers should not care that `logLevel` arrived
 * as `LOG_LEVEL`, and renaming an environment variable should not ripple through
 * application code.
 *
 * ⚠ **This object carries secrets** — `databaseUrl` and `webPush.privateKey`. Never log
 * one, never put one in a span attribute, never return one from a procedure.
 * `createLogger`'s field allowlist (`@playa-post/observability`) drops both because
 * neither is on it — that is a backstop for a mistake, not a licence to make one.
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
  /**
   * VAPID credentials, or **`null` when this deployment sends no Web Push** — the
   * state every environment without the three `VAPID_*` keys is in, including every
   * test harness and every local checkout.
   *
   * Required rather than optional, and `null` rather than an absent key, for the reason
   * `AppContainer.notificationFlush` is: whether push is configured is a decision, and a
   * decision stated in the type is one a new `Configuration` literal cannot forget to
   * make. Composition reads it exactly once, to choose between the real transport and
   * `unconfiguredPushTransport`.
   */
  readonly webPush: WebPushConfiguration | null;
}
