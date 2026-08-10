import { describe, expect, it } from 'vitest';

import { describeThrownForLog, errorDigest } from './route-error-log';

describe('describeThrownForLog', () => {
  it('describes an Error by name and message', () => {
    const described = describeThrownForLog(new Error('the graph query failed'));

    expect(described).toContain('Error');
    expect(described).toContain('the graph query failed');
  });

  // The whole reason this module exists: a throw site hangs its context on the error,
  // and that context is the private data a console log would publish.
  it('leaves an Error’s own properties out of the line entirely', () => {
    const error = Object.assign(new Error('request refused'), { token: 'secret-abc' });

    const described = describeThrownForLog(error);

    expect(described).toContain('request refused');
    expect(described).not.toContain('secret-abc');
  });

  it('reduces a thrown object to its String() form, never its properties', () => {
    const described = describeThrownForLog({ token: 'secret-abc' });

    expect(described).toBe('[object Object]');
    expect(described).not.toContain('secret-abc');
  });

  it('passes a thrown string through', () => {
    expect(describeThrownForLog('a string someone threw')).toBe('a string someone threw');
  });
});

describe('errorDigest', () => {
  it('gives the same token twice for the same failure', () => {
    expect(errorDigest(new Error('boom'), '/board')).toBe(errorDigest(new Error('boom'), '/board'));
  });

  it('gives different tokens for different failures', () => {
    expect(errorDigest(new Error('boom'), '/board')).not.toBe(
      errorDigest(new Error('bang'), '/board'),
    );
  });

  it('carries the path, so a report says where as well as what', () => {
    expect(errorDigest(new Error('boom'), '/board')).toContain('/board');
  });
});
