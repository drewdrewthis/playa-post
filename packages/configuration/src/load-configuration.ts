import {
  environmentSchema,
  type Configuration,
  type ValidatedEnvironment,
} from './environment-schema';

/**
 * Raised when the environment does not satisfy {@link environmentSchema}.
 *
 * The message names the offending **keys only**. Values are never included —
 * a configuration error is the single most likely place for a credential to end
 * up in a log line or a crash report (addendum §17: "No bulletin content or
 * private contact information in routine logs").
 */
export class ConfigurationError extends Error {
  /** Environment variable names that failed validation, sorted and de-duplicated. */
  readonly invalidKeys: readonly string[];

  constructor(invalidKeys: readonly string[]) {
    super(
      `Invalid environment configuration. Offending variables: ${invalidKeys.join(', ')}. ` +
        `Values are omitted from this message on purpose.`,
    );
    this.name = 'ConfigurationError';
    this.invalidKeys = invalidKeys;
  }
}

/** A read-only view of an environment. `process.env` satisfies this. */
export type EnvironmentSource = Readonly<Record<string, string | undefined>>;

/**
 * Validate an environment and map it to the {@link Configuration} consumers use.
 *
 * @param source - Environment to read. Defaults to `process.env`.
 * @throws {ConfigurationError} if any variable is missing or malformed. The error
 *   names the offending keys and never echoes their values.
 *
 * @example
 * ```ts
 * const configuration = loadConfiguration();
 * server.listen({ host: configuration.host, port: configuration.port });
 * ```
 */
export function loadConfiguration(source: EnvironmentSource = process.env): Configuration {
  const result = environmentSchema.safeParse(source);

  if (!result.success) {
    const invalidKeys = [
      ...new Set(result.error.issues.map((issue) => issue.path.join('.') || '<environment>')),
    ].sort();
    throw new ConfigurationError(invalidKeys);
  }

  return toConfiguration(result.data);
}

function toConfiguration(environment: ValidatedEnvironment): Configuration {
  return {
    nodeEnv: environment.NODE_ENV,
    host: environment.HOST,
    port: environment.PORT,
    logLevel: environment.LOG_LEVEL,
    databaseUrl: environment.DATABASE_URL,
    supabaseUrl: environment.SUPABASE_URL,
  };
}
