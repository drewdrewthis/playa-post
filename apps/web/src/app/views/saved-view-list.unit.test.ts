import { describe, expect, it } from 'vitest';

import {
  SAVED_VIEW_NAME_SEED_MAX_LENGTH,
  bellLabel,
  deleteActionLabel,
  matchNowLabel,
  notifyToast,
  seedSavedViewName,
} from './saved-view-list';

describe('seedSavedViewName (comp: `saveQuery`)', () => {
  it('uses the query itself when it is short enough to read', () => {
    expect(seedSavedViewName('type:offer truck')).toBe('type:offer truck');
  });

  it(`truncates past ${String(SAVED_VIEW_NAME_SEED_MAX_LENGTH)} characters with an ellipsis`, () => {
    const long = 'type:request'.padEnd(SAVED_VIEW_NAME_SEED_MAX_LENGTH + 10, 'x');

    expect(seedSavedViewName(long)).toBe(`${long.slice(0, SAVED_VIEW_NAME_SEED_MAX_LENGTH)}…`);
  });

  it('keeps a name of exactly the seed length whole — the boundary is inclusive', () => {
    const atLimit = 'x'.repeat(SAVED_VIEW_NAME_SEED_MAX_LENGTH);

    expect(seedSavedViewName(atLimit)).toBe(atLimit);
  });
});

describe('matchNowLabel (comp: `{{ v.count }} match now`)', () => {
  it('renders the comp copy verbatim, including for one', () => {
    expect(matchNowLabel(3)).toBe('3 match now');
    expect(matchNowLabel(1)).toBe('1 match now');
    expect(matchNowLabel(0)).toBe('0 match now');
  });

  it('renders nothing while the count is unknown — a number nobody has been told is worse than none', () => {
    expect(matchNowLabel(null)).toBeNull();
  });
});

describe('bellLabel (comp: `v.bellLabel`)', () => {
  it('is the comp copy, glyph included', () => {
    expect(bellLabel(true)).toBe('◉ NOTIFY ON');
    expect(bellLabel(false)).toBe('○ NOTIFY OFF');
  });
});

describe('accessible names', () => {
  it('says what the bell will do and to which view, because the visible label is a state', () => {
    expect(bellLabel(false)).toBe('○ NOTIFY OFF');
    expect(notifyToast(true, 'Rides to BRC')).toBe('You’ll hear when new bulletins match');
    expect(notifyToast(false, 'Rides to BRC')).toBe('Notifications off for Rides to BRC');
  });

  it('warns in the delete control’s own name when deleting will also stop notifications', () => {
    expect(deleteActionLabel('Rides', false)).toBe('Delete Rides');
    expect(deleteActionLabel('Rides', true)).toBe(
      'Delete Rides, which also switches its notifications off',
    );
  });
});
