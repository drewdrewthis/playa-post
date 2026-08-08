import { describe, expect, it } from 'vitest';

import { BULLETIN_TYPE } from '@playa-post/contracts';

import {
  buildCreateBulletinPayload,
  BULLETIN_BODY_MAX_LENGTH,
  BULLETIN_LOC_MAX_LENGTH,
  BULLETIN_TITLE_MAX_LENGTH,
  DEFAULT_EXPIRY_PRESET,
  EXPIRY_PRESETS,
  expiresAtFor,
  inspectBulletinDraft,
  type BulletinDraft,
} from './compose-bulletin-draft';

const NOW = new Date('2026-08-08T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function draft(overrides: Partial<BulletinDraft> = {}): BulletinDraft {
  return {
    type: BULLETIN_TYPE.request,
    title: 'Need a ride to the airport',
    body: 'Leaving Sunday morning, happy to chip in for gas.',
    loc: '',
    expiry: 'none',
    ...overrides,
  };
}

describe('expiry presets', () => {
  it('offers no-expiry first, then the comp’s three presets in the comp’s order', () => {
    expect(EXPIRY_PRESETS.map((preset) => preset.id)).toEqual(['none', '24h', '3d', '1w']);
  });

  it('labels the three presets exactly as the comp does', () => {
    expect(EXPIRY_PRESETS.map((preset) => preset.label)).toEqual([
      'No expiry',
      '24h',
      '3 days',
      '1 week',
    ]);
  });

  it('defaults to no expiry, which is the only default the server has', () => {
    expect(DEFAULT_EXPIRY_PRESET).toBe('none');
  });
});

describe('expiresAtFor', () => {
  it('returns nothing for the no-expiry default, so the key is omitted entirely', () => {
    expect(expiresAtFor('none', NOW)).toBeUndefined();
  });

  it('maps 24h to twenty-four hours after now', () => {
    expect(expiresAtFor('24h', NOW)).toBe(new Date(NOW.getTime() + DAY).toISOString());
  });

  it('maps 3d to three days after now', () => {
    expect(expiresAtFor('3d', NOW)).toBe(new Date(NOW.getTime() + 3 * DAY).toISOString());
  });

  it('maps 1w to seven days after now', () => {
    expect(expiresAtFor('1w', NOW)).toBe(new Date(NOW.getTime() + 7 * DAY).toISOString());
  });

  it('returns an ISO-8601 instant of the shape the server’s schema accepts', () => {
    expect(expiresAtFor('24h', NOW)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('never returns a moment the expiry policy would already refuse', () => {
    for (const preset of EXPIRY_PRESETS) {
      const expiresAt = expiresAtFor(preset.id, NOW);

      if (expiresAt !== undefined) {
        expect(new Date(expiresAt).getTime()).toBeGreaterThan(NOW.getTime());
      }
    }
  });
});

describe('inspectBulletinDraft', () => {
  it('reports no issue and is postable for a complete draft', () => {
    expect(inspectBulletinDraft(draft())).toEqual({
      title: null,
      body: null,
      loc: null,
      postable: true,
    });
  });

  it('refuses to post an empty title', () => {
    const issues = inspectBulletinDraft(draft({ title: '' }));

    expect(issues.title).toBe('empty');
    expect(issues.postable).toBe(false);
  });

  it('treats a whitespace-only title as empty, exactly as the server’s trim does', () => {
    expect(inspectBulletinDraft(draft({ title: '   ' })).title).toBe('empty');
  });

  it('accepts a title of exactly the maximum length', () => {
    const issues = inspectBulletinDraft(draft({ title: 'x'.repeat(BULLETIN_TITLE_MAX_LENGTH) }));

    expect(issues.title).toBeNull();
    expect(issues.postable).toBe(true);
  });

  it('refuses a title one character over the maximum', () => {
    const issues = inspectBulletinDraft(draft({ title: 'x'.repeat(BULLETIN_TITLE_MAX_LENGTH + 1) }));

    expect(issues.title).toBe('too-long');
    expect(issues.postable).toBe(false);
  });

  it('measures the title after trimming, so trailing spaces never spend the budget', () => {
    const padded = `${'x'.repeat(BULLETIN_TITLE_MAX_LENGTH)}    `;

    expect(inspectBulletinDraft(draft({ title: padded })).title).toBeNull();
  });

  it('refuses to post an empty body, which is the comp’s rule and not the server’s', () => {
    const issues = inspectBulletinDraft(draft({ body: '  ' }));

    expect(issues.body).toBe('empty');
    expect(issues.postable).toBe(false);
  });

  it('accepts a body of exactly the maximum length', () => {
    expect(inspectBulletinDraft(draft({ body: 'x'.repeat(BULLETIN_BODY_MAX_LENGTH) })).body).toBeNull();
  });

  it('refuses a body one character over the maximum', () => {
    const issues = inspectBulletinDraft(draft({ body: 'x'.repeat(BULLETIN_BODY_MAX_LENGTH + 1) }));

    expect(issues.body).toBe('too-long');
    expect(issues.postable).toBe(false);
  });

  it('treats an empty location as no issue, because location is optional', () => {
    const issues = inspectBulletinDraft(draft({ loc: '' }));

    expect(issues.loc).toBeNull();
    expect(issues.postable).toBe(true);
  });

  it('accepts a location of exactly the maximum length', () => {
    expect(inspectBulletinDraft(draft({ loc: 'x'.repeat(BULLETIN_LOC_MAX_LENGTH) })).loc).toBeNull();
  });

  it('refuses a location one character over the maximum', () => {
    const issues = inspectBulletinDraft(draft({ loc: 'x'.repeat(BULLETIN_LOC_MAX_LENGTH + 1) }));

    expect(issues.loc).toBe('too-long');
    expect(issues.postable).toBe(false);
  });
});

describe('buildCreateBulletinPayload', () => {
  it('carries the chosen type', () => {
    expect(buildCreateBulletinPayload(draft(), NOW).type).toBe(BULLETIN_TYPE.request);
  });

  it('trims the title and the body, so the stored value is the value that was checked', () => {
    const payload = buildCreateBulletinPayload(draft({ title: '  Ride  ', body: '  Sunday  ' }), NOW);

    expect(payload.title).toBe('Ride');
    expect(payload.body).toBe('Sunday');
  });

  it('omits loc entirely when the field trims to nothing', () => {
    const payload = buildCreateBulletinPayload(draft({ loc: '   ' }), NOW);

    expect(Object.hasOwn(payload, 'loc')).toBe(false);
  });

  it('carries the trimmed location when one was typed', () => {
    expect(buildCreateBulletinPayload(draft({ loc: '  7:30 & E  ' }), NOW).loc).toBe('7:30 & E');
  });

  it('omits expiresAt for the no-expiry default', () => {
    const payload = buildCreateBulletinPayload(draft({ expiry: 'none' }), NOW);

    expect(Object.hasOwn(payload, 'expiresAt')).toBe(false);
  });

  it('carries the preset’s computed moment as expiresAt', () => {
    const payload = buildCreateBulletinPayload(draft({ expiry: '3d' }), NOW);

    expect(payload.expiresAt).toBe(new Date(NOW.getTime() + 3 * DAY).toISOString());
  });
});
