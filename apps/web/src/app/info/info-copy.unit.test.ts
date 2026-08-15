import { describe, expect, it } from 'vitest';

import { WELCOME_STEPS } from '../welcome/welcome-steps';

import {
  BUY_ME_A_COFFEE_URL,
  GITHUB_REPO_URL,
  INFO_PITCH,
  INFO_VALUES,
} from './info-copy';

/**
 * The Info screen's copy contract (issue #216): its prose is the welcome carousel's,
 * single-sourced, and its links point where they claim to.
 */
describe('info copy', () => {
  describe('single-sourcing from the welcome carousel', () => {
    it('shows the carousel’s opening pitch, not a retyped copy', () => {
      expect(INFO_PITCH).toBe(WELCOME_STEPS[0]?.body);
    });

    it('shows the carousel’s values close, not a retyped copy', () => {
      expect(INFO_VALUES).toBe(WELCOME_STEPS.at(-1)?.body);
    });

    // The derivation reads first and last by position, so this test exists to fail
    // loudly if the carousel is ever reordered so those slots stop being the pitch
    // and the values close (#214 put them there).
    it('the first step is the extended-family pitch and the last is the values close', () => {
      expect(WELCOME_STEPS[0]?.title).toBe('Your extended family');
      expect(WELCOME_STEPS.at(-1)?.title).toBe('Real people, real trust');
    });
  });

  describe('links', () => {
    it('points the source link at the public repository', () => {
      expect(GITHUB_REPO_URL).toBe('https://github.com/drewdrewthis/playa-post');
    });

    it('points support at the Buy Me a Coffee page, not the embed widget CDN', () => {
      expect(BUY_ME_A_COFFEE_URL).toBe('https://buymeacoffee.com/playapost');
      expect(BUY_ME_A_COFFEE_URL).not.toContain('cdnjs');
    });
  });
});
