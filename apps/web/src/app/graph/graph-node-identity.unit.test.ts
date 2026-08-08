import { describe, expect, it } from 'vitest';

import { nodeInitial, nodeLabel } from './graph-node-identity';

describe('nodeInitial', () => {
  it('takes the first letter of the display name, capitalised', () => {
    expect(nodeInitial({ displayName: 'moss', handle: 'mossy' })).toBe('M');
  });

  it('falls back to the handle when only that is disclosed', () => {
    expect(nodeInitial({ handle: 'dustdevil' })).toBe('D');
  });

  it('draws nothing for a person the projection withheld', () => {
    expect(nodeInitial({})).toBeUndefined();
  });

  it('treats a blank name as no name rather than as a blank letter', () => {
    expect(nodeInitial({ displayName: '   ', handle: 'ember' })).toBe('E');
    expect(nodeInitial({ displayName: '   ' })).toBeUndefined();
  });

  it('keeps a whole first character, not half a surrogate pair', () => {
    expect(nodeInitial({ displayName: '🔥 Fire crew' })).toBe('🔥');
  });
});

describe('nodeLabel', () => {
  it('writes the display name', () => {
    expect(nodeLabel({ displayName: 'Moss', handle: 'mossy' })).toBe('Moss');
  });

  it('writes the handle, at-prefixed, when there is no display name', () => {
    expect(nodeLabel({ handle: 'mossy' })).toBe('@mossy');
  });

  it('writes nothing for a person the projection withheld', () => {
    expect(nodeLabel({})).toBeUndefined();
  });
});
