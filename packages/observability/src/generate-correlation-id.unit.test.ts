import { describe, expect, it } from 'vitest';

import { generateCorrelationId } from './generate-correlation-id';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('generateCorrelationId', () => {
  it('returns a well-formed UUID', () => {
    expect(generateCorrelationId()).toMatch(UUID_PATTERN);
  });

  it('returns a distinct value on each call', () => {
    const first = generateCorrelationId();
    const second = generateCorrelationId();

    expect(first).not.toEqual(second);
  });
});
