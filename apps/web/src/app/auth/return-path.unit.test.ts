import { describe, expect, it } from 'vitest';

import { capturePath, returnPathFrom } from './return-path';

/**
 * Pins the deep-link hand-off contract (#205): what `RequireSession` captures, and
 * which forwarded values the auth screens will actually honour. The rejection cases
 * are the point — router state comes from `history.state`, so a value that is not an
 * origin-relative path must read as "no destination", never as somewhere to send a
 * fresh session.
 */
describe('capturePath', () => {
  it('keeps path, query, and fragment together', () => {
    const location = {
      pathname: '/invite/abc123',
      search: '?ref=qr',
      hash: '#top',
      state: null,
      key: 'k1',
    };

    expect(capturePath(location)).toEqual({ from: '/invite/abc123?ref=qr#top' });
  });
});

describe('returnPathFrom', () => {
  it('returns a forwarded origin-relative path', () => {
    expect(returnPathFrom({ from: '/invite/abc123?ref=qr' })).toBe('/invite/abc123?ref=qr');
  });

  it.each([
    ['no state at all', null],
    ['state without from', { other: true }],
    ['a non-string from', { from: 7 }],
    ['a relative path', { from: 'invite/abc' }],
    ['an absolute URL', { from: 'https://evil.example/phish' }],
    // `//host/path` is scheme-relative: the browser would leave this origin entirely.
    ['a scheme-relative URL', { from: '//evil.example/phish' }],
  ])('refuses %s', (_name, state) => {
    expect(returnPathFrom(state)).toBeNull();
  });
});
