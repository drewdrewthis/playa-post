import { describe, expect, it } from 'vitest';

import { ConfigurationError, loadConfiguration } from './load-configuration';

describe('loadConfiguration', () => {
  it('applies defaults when the environment supplies nothing', () => {
    const configuration = loadConfiguration({});

    expect(configuration).toEqual({
      nodeEnv: 'development',
      host: '127.0.0.1',
      port: 3000,
      logLevel: 'info',
    });
  });

  it('coerces PORT from the string the process actually receives', () => {
    const configuration = loadConfiguration({ PORT: '8080' });

    expect(configuration.port).toBe(8080);
  });

  it('maps environment variable names onto the consumer-facing shape', () => {
    const configuration = loadConfiguration({
      NODE_ENV: 'production',
      HOST: '0.0.0.0',
      LOG_LEVEL: 'warn',
    });

    expect(configuration).toEqual({
      nodeEnv: 'production',
      host: '0.0.0.0',
      port: 3000,
      logLevel: 'warn',
    });
  });

  it('rejects a malformed value instead of silently falling back to the default', () => {
    expect(() => loadConfiguration({ PORT: '70000' })).toThrow(ConfigurationError);
    expect(() => loadConfiguration({ NODE_ENV: 'staging' })).toThrow(ConfigurationError);
  });

  it('names every offending key once, sorted', () => {
    let thrown: unknown;
    try {
      loadConfiguration({ PORT: 'not-a-port', LOG_LEVEL: 'chatty', NODE_ENV: 'staging' });
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
      loadConfiguration({ PORT: secretish });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ConfigurationError);
    const message = (thrown as ConfigurationError).message;
    expect(message).toContain('PORT');
    expect(message).not.toContain(secretish);
    expect(message).not.toContain('hunter2');
  });
});
