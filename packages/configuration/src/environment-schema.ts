import { z } from 'zod';

/**
 * The environment variables every Playa Post runtime understands.
 *
 * Rules for anything added here:
 * - **Never give a secret a default.** A default that works in production is a
 *   secret in source control (addendum §17). Secrets are required, unvalidated
 *   in shape beyond "present and non-empty", and never logged.
 * - Keep the key set to what a runtime actually reads today. An unused key is
 *   an empty abstraction (§4).
 */
export const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  /** Levels are pino's, because the HTTP entrypoint's logger is pino (addendum §18). */
  LOG_LEVEL: z
    .enum(['silent', 'fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .default('info'),
});

/** Raw, validated environment. Prefer {@link Configuration} in consuming code. */
export type ValidatedEnvironment = z.infer<typeof environmentSchema>;

/**
 * The shape consumers actually receive.
 *
 * Deliberately not the raw env: consumers should not care that `logLevel` arrived
 * as `LOG_LEVEL`, and renaming an environment variable should not ripple through
 * application code.
 */
export interface Configuration {
  readonly nodeEnv: ValidatedEnvironment['NODE_ENV'];
  readonly host: string;
  readonly port: number;
  readonly logLevel: ValidatedEnvironment['LOG_LEVEL'];
}
