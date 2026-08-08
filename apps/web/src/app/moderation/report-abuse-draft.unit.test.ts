import { describe, expect, it } from 'vitest';

import { REPORT_REASON } from '@playa-post/contracts';

import {
  buildReportPayload,
  emptyReportAbuseDraft,
  REPORT_DETAIL_MAX_LENGTH,
  REPORT_REASON_CHOICES,
  reportDraftIssue,
  type ReportAbuseDraft,
} from './report-abuse-draft';

const BULLETIN_ID = '33333333-3333-4333-8333-333333333333';

function draft(overrides: Partial<ReportAbuseDraft> = {}): ReportAbuseDraft {
  return { ...emptyReportAbuseDraft(), ...overrides };
}

/**
 * The report sheet's rules, away from the sheet.
 *
 * The comp gates Send on **both** a chosen chip and non-blank words
 * (`design/Playa Post.dc.html:848` — `if (!S.reportType || !S.reportMsg.trim()) return;`),
 * and dims the control to `.45` until then (`:846`). Those two facts are the whole of
 * this module, and they live here rather than inside the component so they can be
 * asserted without a DOM.
 */
describe('REPORT_REASON_CHOICES', () => {
  it('offers the comp’s five chips, in the comp’s order and with the comp’s copy', () => {
    expect(REPORT_REASON_CHOICES.map((choice) => choice.label)).toEqual([
      'Harassment',
      'Scam or fraud',
      'Impersonation',
      'Spam',
      'Safety risk',
    ]);
  });

  it('maps each label onto the wire code the server’s vocabulary declares', () => {
    expect(REPORT_REASON_CHOICES.map((choice) => choice.reason)).toEqual([
      REPORT_REASON.harassment,
      REPORT_REASON.scamOrFraud,
      REPORT_REASON.impersonation,
      REPORT_REASON.spam,
      REPORT_REASON.safetyRisk,
    ]);
  });
});

describe('emptyReportAbuseDraft', () => {
  it('starts with no reason chosen — the comp preselects none', () => {
    expect(emptyReportAbuseDraft().reason).toBeNull();
  });

  it('starts with an empty detail', () => {
    expect(emptyReportAbuseDraft().detail).toBe('');
  });
});

describe('reportDraftIssue', () => {
  it('is "no-reason" before a chip is tapped, even with words written', () => {
    expect(reportDraftIssue(draft({ detail: 'They took the money and left.' }))).toBe('no-reason');
  });

  it('is "no-detail" with a chip but no words', () => {
    expect(reportDraftIssue(draft({ reason: REPORT_REASON.spam }))).toBe('no-detail');
  });

  it('is "no-detail" when the words are only whitespace', () => {
    expect(reportDraftIssue(draft({ reason: REPORT_REASON.spam, detail: '   \n  ' }))).toBe(
      'no-detail',
    );
  });

  it('is "too-long" past the mirrored bound', () => {
    expect(
      reportDraftIssue(
        draft({ reason: REPORT_REASON.spam, detail: 'x'.repeat(REPORT_DETAIL_MAX_LENGTH + 1) }),
      ),
    ).toBe('too-long');
  });

  it('measures the bound after trimming, matching the server', () => {
    expect(
      reportDraftIssue(
        draft({
          reason: REPORT_REASON.spam,
          detail: `  ${'x'.repeat(REPORT_DETAIL_MAX_LENGTH)}  `,
        }),
      ),
    ).toBeNull();
  });

  it('is null once a chip and words are both there', () => {
    expect(
      reportDraftIssue(draft({ reason: REPORT_REASON.harassment, detail: 'They followed me.' })),
    ).toBeNull();
  });
});

describe('buildReportPayload', () => {
  it('sends the chosen reason and the trimmed detail', () => {
    expect(
      buildReportPayload(
        BULLETIN_ID,
        draft({ reason: REPORT_REASON.safetyRisk, detail: '  Unlit rebar across the path.  ' }),
      ),
    ).toEqual({
      bulletinId: BULLETIN_ID,
      reason: 'safety-risk',
      detail: 'Unlit rebar across the path.',
    });
  });

  /*
   * A sendable-only payload builder, rather than one that silently substitutes a
   * default reason: a report filed under a category the reporter did not choose is a
   * false statement attributed to them, and it is the stewards who would act on it.
   */
  it('refuses to build a payload from a draft that is not sendable', () => {
    expect(() => buildReportPayload(BULLETIN_ID, draft({ detail: 'Something happened.' }))).toThrow();
  });

  it('carries no reporter identifier — the actor is resolved server-side', () => {
    const payload = buildReportPayload(
      BULLETIN_ID,
      draft({ reason: REPORT_REASON.spam, detail: 'Ten identical posts.' }),
    );

    expect(Object.keys(payload).sort()).toEqual(['bulletinId', 'detail', 'reason']);
  });
});
