import { describe, expect, it } from 'vitest';

import { filterAllowedFields } from './filter-allowed-fields';

describe('filterAllowedFields', () => {
  it('keeps only allowlisted top-level keys', () => {
    const result = filterAllowedFields({ body: 'secret text', userId: 'u1' }, new Set(['userId']));

    expect(result).toEqual({ userId: 'u1' });
  });

  it('drops every key when the allowlist is empty', () => {
    const result = filterAllowedFields({ body: 'secret text' }, new Set());

    expect(result).toEqual({});
  });

  it('drops a nested object entirely when its own key is not allowlisted', () => {
    const result = filterAllowedFields(
      { bulletin: { body: 'secret text' }, userId: 'u1' },
      new Set(['userId']),
    );

    expect(result).toEqual({ userId: 'u1' });
  });

  it('recursively filters a nested object reached through an allowlisted key', () => {
    const result = filterAllowedFields(
      { context: { body: 'secret text', userId: 'u1' } },
      new Set(['context', 'userId']),
    );

    expect(result).toEqual({ context: { userId: 'u1' } });
  });

  it('recursively filters plain objects nested inside an allowlisted array', () => {
    const result = filterAllowedFields(
      { items: [{ body: 'secret text', userId: 'u1' }] },
      new Set(['items', 'userId']),
    );

    expect(result).toEqual({ items: [{ userId: 'u1' }] });
  });

  it('leaves primitive array entries untouched', () => {
    const result = filterAllowedFields({ tags: ['a', 'b', 'c'] }, new Set(['tags']));

    expect(result).toEqual({ tags: ['a', 'b', 'c'] });
  });

  it('preserves allowlisted primitive values of every type, including falsy ones', () => {
    const result = filterAllowedFields(
      { active: false, count: 0, label: '', userId: 'u1' },
      new Set(['active', 'count', 'label', 'userId']),
    );

    expect(result).toEqual({ active: false, count: 0, label: '', userId: 'u1' });
  });

  it('does not mutate the input object', () => {
    const input = { body: 'secret text', userId: 'u1' };

    filterAllowedFields(input, new Set(['userId']));

    expect(input).toEqual({ body: 'secret text', userId: 'u1' });
  });

  it('applies the same allow/deny decision to a key name recurring at a different depth', () => {
    // Filtering is by key name, not by path (documented on filterAllowedFields):
    // 'userId' must survive at both depths and 'body' must be dropped at both,
    // with no special-casing for the nested occurrence either way.
    const result = filterAllowedFields(
      {
        body: 'top-level secret',
        context: { body: 'nested secret', userId: 'nested-u2' },
        userId: 'top-level-u1',
      },
      new Set(['context', 'userId']),
    );

    expect(result).toEqual({ context: { userId: 'nested-u2' }, userId: 'top-level-u1' });
  });
});
