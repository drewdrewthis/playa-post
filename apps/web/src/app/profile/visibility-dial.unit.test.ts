import { describe, expect, it } from 'vitest';

import { VISIBLE_TO_DISTANCE_OPTIONS } from '@playa-post/contracts';

import { describeVisibility, nextVisibility, VISIBILITY_DIAL_LABELS } from './visibility-dial';

describe('the Who-can-see-you dial', () => {
  it('cycles 1st → 2nd → 3rd → 6th and loops, like the comp', () => {
    expect(nextVisibility('first')).toBe('second');
    expect(nextVisibility('second')).toBe('third');
    expect(nextVisibility('third')).toBe('sixth');
    expect(nextVisibility('sixth')).toBe('first');
  });

  it('has a label and a description for every value the server accepts', () => {
    for (const option of VISIBLE_TO_DISTANCE_OPTIONS) {
      expect(VISIBILITY_DIAL_LABELS[option]).toBeTruthy();
      expect(describeVisibility(option)).toBeTruthy();
    }
  });

  it('describes absence, not anonymity — "at all", per the product owner', () => {
    expect(describeVisibility('second')).toContain('not on their graph at all');
  });
});
