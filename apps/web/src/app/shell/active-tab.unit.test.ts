import { describe, expect, it } from 'vitest';

import { activeTabFor } from './active-tab';

describe('activeTabFor', () => {
  describe('given the app root', () => {
    it('maps "/" to the Graph tab', () => {
      expect(activeTabFor('/')).toBe('graph');
    });
  });

  describe('given each tab route', () => {
    it('maps "/graph" to the Graph tab', () => {
      expect(activeTabFor('/graph')).toBe('graph');
    });

    it('maps "/board" to the Board tab', () => {
      expect(activeTabFor('/board')).toBe('board');
    });

    it('maps "/info" to the Info tab', () => {
      expect(activeTabFor('/info')).toBe('info');
    });

    it('maps "/you" to the You tab', () => {
      expect(activeTabFor('/you')).toBe('you');
    });
  });

  describe('given a nested path one level below a tab route', () => {
    it('maps "/board/new" to the Board tab', () => {
      expect(activeTabFor('/board/new')).toBe('board');
    });
  });

  describe('given the retired person-page path', () => {
    // A person opens as a sheet over the graph now, never as a path — a URL that no
    // route serves must not light a tab as if it were somewhere.
    it('returns null for "/people/:userId"', () => {
      expect(activeTabFor('/people/abc-123')).toBeNull();
    });
  });

  describe('given a path unrelated to any tab', () => {
    it('returns null for "/invite/:token"', () => {
      expect(activeTabFor('/invite/some-token')).toBeNull();
    });

    it('returns null for "/signin"', () => {
      expect(activeTabFor('/signin')).toBeNull();
    });

    it('returns null for "/onboarding"', () => {
      expect(activeTabFor('/onboarding')).toBeNull();
    });

    it('returns null for an unrecognized path', () => {
      expect(activeTabFor('/does-not-exist')).toBeNull();
    });
  });

  describe('given a path that merely starts with a tab path as a substring', () => {
    it('does not match "/boardroom" to the Board tab', () => {
      expect(activeTabFor('/boardroom')).toBeNull();
    });

    it('does not match "/graphs" to the Graph tab', () => {
      expect(activeTabFor('/graphs')).toBeNull();
    });
  });
});
