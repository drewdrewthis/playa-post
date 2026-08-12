import { describe, expect, it } from 'vitest';

import {
  SAVED_VIEW_NAME_SEED_MAX_LENGTH,
  bellActionLabel,
  bellLabel,
  deleteActionLabel,
  matchNowLabel,
  notifyToast,
  saveViewFailureMessage,
  seedSavedViewName,
  setNotifyFailureMessage,
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
  it('names the view in the bell’s accessible name, because the visible label is only a state', () => {
    // The visible text is identical on every card, so the name is the only thing that
    // tells one bell from another when there are two dozen of them.
    expect(bellLabel(false)).toBe('○ NOTIFY OFF');
    expect(bellActionLabel('Rides to BRC')).toBe('Notify me about Rides to BRC');
    expect(bellActionLabel('Coffee near 7:30')).toBe('Notify me about Coffee near 7:30');
  });

  it('keeps the bell’s name fixed across states, leaving lit-ness to aria-pressed', () => {
    // A toggle whose *name* changes when pressed reads as a different control each time.
    expect(bellActionLabel('Rides')).toBe(bellActionLabel('Rides'));
  });

  it('says what tapping the bell did, naming the view when it switched them off', () => {
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

/**
 * A tRPC rejection carrying an application code, in the envelope shape
 * `shared/trpc/trpc.ts`'s `errorFormatter` produces — the same hand-built fixture
 * `hide-failure.unit.test.ts` uses, and for the same reason: this function reads one
 * field off an envelope and that field is the whole contract.
 */
function refusal(applicationCode: string, message: string): unknown {
  return Object.assign(new Error(message), {
    data: { code: 'BAD_REQUEST', applicationCode },
  });
}

/** What a dropped connection looks like: a rejection with no envelope at all. */
const TRANSPORT_FAILURE: unknown = new TypeError('Failed to fetch');

const CONNECTION_MESSAGE = 'That view could not be saved. Check your connection and try again.';

describe('saveViewFailureMessage', () => {
  it('tells someone at the cap to delete a view, not to check their connection', () => {
    // ⚠ The defect this exists to close. "Check your connection" is advice a person will
    // act on, and retrying at the cap fails identically forever.
    const atCap = refusal(
      'SAVED_VIEW_LIMIT_REACHED',
      'You can keep up to 24 saved views. Delete one to save another.',
    );

    expect(saveViewFailureMessage(atCap)).toBe(
      'You can keep up to 24 saved views. Delete one to save another.',
    );
    expect(saveViewFailureMessage(atCap)).not.toBe(CONNECTION_MESSAGE);
  });

  it('passes through the name refusal, which names the bound rather than echoing the input', () => {
    const badName = refusal(
      'SAVED_VIEW_NAME_INVALID',
      'A view’s name must not be empty and may be at most 80 characters.',
    );

    expect(saveViewFailureMessage(badName)).toBe(
      'A view’s name must not be empty and may be at most 80 characters.',
    );
  });

  it('passes through the grammar’s own refusal, which names the token it could not apply', () => {
    const badQuery = refusal('INVALID_BOARD_QUERY', 'This board does not understand `from:`.');

    expect(saveViewFailureMessage(badQuery)).toBe('This board does not understand `from:`.');
  });

  it('says to check the connection only when there was no answer to read', () => {
    expect(saveViewFailureMessage(TRANSPORT_FAILURE)).toBe(CONNECTION_MESSAGE);
  });

  it('does not invent an explanation for a code it has no remedy for', () => {
    // An unrecognised refusal falls back rather than passing through a sentence this app
    // has never read — the discipline `hide-failure.ts` sets.
    expect(saveViewFailureMessage(refusal('SOMETHING_NEW', 'internal detail'))).toBe(
      CONNECTION_MESSAGE,
    );
  });
});

/**
 * The bell's own refusal path, which arrived with decision D16 (issue #172).
 *
 * Under D1 a bell tap could only fail by not arriving — there was one query per person and
 * lighting one moved it, so there was nothing to refuse. Several may now be lit at once and
 * the number is capped, which gives this control its first judged failure.
 */
describe('setNotifyFailureMessage', () => {
  const NOTIFY_CONNECTION_MESSAGE =
    'Notifications for Rides could not be changed. Check your connection and try again.';

  it('tells someone at the notification cap to switch one off, not to check their connection', () => {
    // ⚠ The same defect `saveViewFailureMessage` closes, on the control D16 made
    // refusable: retrying at the cap fails identically forever, and the one thing that
    // would work is what the server said.
    const atCap = refusal(
      'NOTIFY_ME_QUERY_LIMIT_REACHED',
      'You can have notifications on for up to 6 saved views. Switch one off to add another.',
    );

    expect(setNotifyFailureMessage(atCap, 'Rides')).toBe(
      'You can have notifications on for up to 6 saved views. Switch one off to add another.',
    );
    expect(setNotifyFailureMessage(atCap, 'Rides')).not.toBe(NOTIFY_CONNECTION_MESSAGE);
  });

  it('names the view when there was no answer to read, because every bell looks alike', () => {
    expect(setNotifyFailureMessage(TRANSPORT_FAILURE, 'Rides')).toBe(NOTIFY_CONNECTION_MESSAGE);
  });

  it('does not pass through a refusal it has no remedy for', () => {
    // `SAVED_VIEW_UNAVAILABLE` is the live case: a card whose view was deleted on another
    // device is not something a sentence helps with, and the refetch removes the card.
    expect(
      setNotifyFailureMessage(
        refusal('SAVED_VIEW_UNAVAILABLE', 'That saved view is no longer available.'),
        'Rides',
      ),
    ).toBe(NOTIFY_CONNECTION_MESSAGE);
  });
});
