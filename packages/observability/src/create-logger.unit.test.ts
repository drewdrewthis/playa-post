import { Writable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { createLogger } from './create-logger';

function createCapturingDestination(): { readonly stream: Writable; readonly lines: string[] } {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void) {
      lines.push(chunk.toString());
      callback();
    },
  });
  return { stream, lines };
}

describe('createLogger', () => {
  it('drops non-allowlisted fields from an emitted log line (M1-AC11)', () => {
    const { stream, lines } = createCapturingDestination();
    const logger = createLogger({ level: 'info' }, stream);

    logger.info({ body: 'secret text', userId: 'u1' }, 'bulletin created');

    const emitted = lines.join('');
    expect(emitted).toContain('u1');
    expect(emitted).not.toContain('secret text');
  });

  it('keeps a default-allowlisted field intact end to end', () => {
    const { stream, lines } = createCapturingDestination();
    const logger = createLogger({ level: 'info' }, stream);

    logger.info({ correlationId: 'corr-1' }, 'request handled');

    const parsed = JSON.parse(lines.join('')) as Record<string, unknown>;
    expect(parsed['correlationId']).toEqual('corr-1');
  });

  it('honors an explicit allowlist over the default', () => {
    const { stream, lines } = createCapturingDestination();
    const logger = createLogger({ allowedFields: ['correlationId'], level: 'info' }, stream);

    logger.info({ correlationId: 'c1', userId: 'u1' }, 'request handled');

    const emitted = lines.join('');
    expect(emitted).toContain('c1');
    expect(emitted).not.toContain('u1');
  });

  it('suppresses log lines below the configured level', () => {
    const { stream, lines } = createCapturingDestination();
    const logger = createLogger({ level: 'warn' }, stream);

    logger.info({ userId: 'u1' }, 'should not appear');

    expect(lines.join('')).toEqual('');
  });

  it('emits a bound name when one is configured', () => {
    const { stream, lines } = createCapturingDestination();
    const logger = createLogger({ level: 'info', name: 'playa-post-server' }, stream);

    logger.info({}, 'boot');

    const parsed = JSON.parse(lines.join('')) as Record<string, unknown>;
    expect(parsed['name']).toEqual('playa-post-server');
  });
});
