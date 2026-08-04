import pino, { type DestinationStream, type Logger, type LoggerOptions } from 'pino';

import { filterAllowedFields } from './filter-allowed-fields';

/**
 * Pino's own level names (addendum §18 — pino is the chosen structured
 * logger). Kept local to this package rather than imported from
 * `@playa-post/configuration`: this package is what actually knows which
 * levels pino accepts, and `@playa-post/configuration`'s `LOG_LEVEL` schema
 * derives from the same fact independently rather than depending on this
 * package.
 */
export type LogLevel = 'silent' | 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';

/**
 * What {@link createLogger} returns, re-exported so a consumer can declare a logger
 * field without importing pino itself.
 *
 * This package owns the "pino is the structured logger" decision (addendum §18). A
 * server file that writes `import type { Logger } from 'pino'` has taken a direct
 * dependency on that choice — and, more practically, has to add pino to its own
 * `package.json` to type one field.
 */
export type { Logger } from 'pino';

/**
 * Field names permitted to leave the process by default.
 *
 * Deliberately small. `correlationId` makes request tracing possible at
 * all; `userId` is the M1-AC11 worked example. Nothing here can, by itself,
 * carry bulletin content or a contact value. Extend it explicitly per
 * {@link CreateLoggerOptions.allowedFields} rather than widening this
 * default — a wider default is invisible to whoever adds the next field.
 */
export const DEFAULT_ALLOWED_LOG_FIELDS: readonly string[] = [
  'correlationId',
  'userId',
  'route',
  'method',
  'statusCode',
  'durationMs',
];

/** Everything {@link createLogger} needs. Explicit config only — this
 * package never reads `process.env` (architecture-addendum §17); only
 * `composition/` may.
 */
export interface CreateLoggerOptions {
  /** Minimum level that reaches the destination. */
  readonly level: LogLevel;
  /** Bound into every line as `name`. Omit for no name binding. */
  readonly name?: string;
  /**
   * Field names allowed to survive redaction, applied recursively via
   * {@link filterAllowedFields}. Defaults to {@link DEFAULT_ALLOWED_LOG_FIELDS}.
   */
  readonly allowedFields?: readonly string[];
}

/**
 * Build a pino logger whose emitted fields are restricted to an explicit
 * allowlist.
 *
 * `logger.info({ body: bulletin.body, userId: actor.id }, 'bulletin created')`
 * emits `userId` and never `body` — the field simply is not present in the
 * output — regardless of what fields a call site passes, satisfying
 * M1-AC11 and addendum §25 ("no bulletin content or private contact
 * information in routine logs").
 *
 * @param options - Level, optional name, and optional allowlist override.
 * @param destination - Where lines are written. Defaults to pino's own
 *   default (stdout) when omitted; tests pass an in-memory
 *   {@link DestinationStream} to capture output without touching a real
 *   stream.
 *
 * @example
 * ```ts
 * const logger = createLogger({ level: configuration.logLevel });
 * logger.info({ correlationId, userId: actor.id }, 'onboarding completed');
 * ```
 */
export function createLogger(options: CreateLoggerOptions, destination?: DestinationStream): Logger {
  const allowedKeys = new Set(options.allowedFields ?? DEFAULT_ALLOWED_LOG_FIELDS);
  const pinoOptions: LoggerOptions = {
    level: options.level,
    ...(options.name !== undefined ? { name: options.name } : {}),
    formatters: {
      log: (fields: Record<string, unknown>) => filterAllowedFields(fields, allowedKeys),
    },
  };

  return destination !== undefined ? pino(pinoOptions, destination) : pino(pinoOptions);
}
