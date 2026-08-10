import { describe, expect, it } from 'vitest';

import type { IntroOutboxRow, IntroPerson, IntroRequestStatus } from '@playa-post/contracts';

import { describeIntroStanding } from './intro-outbox-state';

const KIKI = 'kiki-id';
const OMAR = 'omar-id';

const VIA_LENA: IntroPerson = { userId: 'lena-id', disclosure: 'full', displayName: 'Lena' };

/*
 * ⚠ The via is spread in conditionally rather than assigned. Under
 * `exactOptionalPropertyTypes` an absent card and a card set to `undefined` are two
 * different shapes, and "absent" is the one the wire actually sends.
 */
function row(
  status: IntroRequestStatus,
  fields: {
    readonly id?: string;
    readonly targetUserId?: string;
    readonly createdAt?: string;
    readonly via?: IntroPerson;
  } = {},
): IntroOutboxRow {
  return {
    id: fields.id ?? `request-${status}`,
    status,
    targetUserId: fields.targetUserId ?? KIKI,
    createdAt: fields.createdAt ?? '2026-08-01T00:00:00.000Z',
    ...(fields.via === undefined ? {} : { via: fields.via }),
  };
}

describe('describeIntroStanding', () => {
  it('offers the control when the viewer has never asked about this person', () => {
    expect(describeIntroStanding([], KIKI)).toEqual({ kind: 'none' });
  });

  it('ignores asks about somebody else entirely', () => {
    expect(describeIntroStanding([row('requested', { targetUserId: OMAR })], KIKI)).toEqual({
      kind: 'none',
    });
  });

  it('names the via while the ask is open', () => {
    expect(describeIntroStanding([row('requested', { via: VIA_LENA })], KIKI)).toEqual({
      kind: 'pending',
      line: 'Intro pending via Lena',
    });
  });

  /*
   * An outbox row outlives the relationship that carried it, so the via card can be
   * absent. "Intro pending" is the sentence for that — never a name reconstructed from
   * the viewer's own graph, on the one surface where they are most likely to think they
   * know it.
   */
  it('still reports the ask when the via may no longer be named', () => {
    expect(describeIntroStanding([row('requested')], KIKI)).toEqual({
      kind: 'pending',
      line: 'Intro pending',
    });
  });

  it('says an ask was not passed on, with nothing else attached to it', () => {
    expect(describeIntroStanding([row('declined', { via: VIA_LENA })], KIKI)).toEqual({
      kind: 'declined',
      line: 'Your ask was not passed on.',
    });
  });

  it('says an ask was passed on', () => {
    expect(describeIntroStanding([row('passed_on')], KIKI).kind).toBe('passed-on');
  });

  /*
   * ⚠ The load-bearing precedence. A requester declined last week who asked again through
   * somebody else has one live ask and one settled record; rendering the decline would
   * tell them their open request is dead — and offering the control would be worse, since
   * `intro_requests_open_per_pair_idx` refuses a second open ask for the pair.
   */
  it('lets a live ask outrank an older decided one, whatever order they arrive in', () => {
    const declined = row('declined', { id: 'old', createdAt: '2026-08-09T00:00:00.000Z' });
    const open = row('requested', {
      id: 'new',
      createdAt: '2026-08-01T00:00:00.000Z',
      via: VIA_LENA,
    });

    expect(describeIntroStanding([open, declined], KIKI).kind).toBe('pending');
    expect(describeIntroStanding([declined, open], KIKI).kind).toBe('pending');
  });

  // Among decided rows the newest speaks, compared on the timestamp rather than on
  // arrival order — a read model that changes its sort must not change what this says.
  it('reports the newest decided ask when none is open', () => {
    const older = row('declined', { id: 'older', createdAt: '2026-07-01T00:00:00.000Z' });
    const newer = row('passed_on', { id: 'newer', createdAt: '2026-08-02T00:00:00.000Z' });

    expect(describeIntroStanding([older, newer], KIKI).kind).toBe('passed-on');
    expect(describeIntroStanding([newer, older], KIKI).kind).toBe('passed-on');
  });
});
