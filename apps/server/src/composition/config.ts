import { loadConfiguration, type Configuration } from '@playa-post/configuration';

export type { Configuration } from '@playa-post/configuration';

/**
 * Read and validate the server's environment.
 *
 * **This is the only place in `apps/server` that may touch `process.env`.**
 * Everything downstream receives a {@link Configuration} through its constructor
 * or its factory argument — an ambient environment read inside a module is an
 * untestable hidden dependency and a violation of the composition-root rule
 * (addendum §12, ADR-0003).
 *
 * @param environment - Overridable for tests. Defaults to the real process environment.
 * @throws {import('@playa-post/configuration').ConfigurationError} when the
 *   environment is invalid. The error names the offending keys, never their values.
 */
export function loadServerConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
): Configuration {
  return loadConfiguration(environment);
}
