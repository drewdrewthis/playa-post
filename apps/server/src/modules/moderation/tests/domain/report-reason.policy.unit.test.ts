import { describe, expect, it } from 'vitest';

import { ReportDetailInvalidError } from '../../domain/moderation.errors';
import {
  LEGACY_REPORT_REASON,
  REPORT_DETAIL_MAX_LENGTH,
  REPORT_REASON,
} from '../../domain/report-reason';
import { validateReportDetail } from '../../domain/report-reason.policy';

/**
 * The report reason vocabulary and the free-text detail's one bound.
 *
 * The vocabulary is asserted against `design/Playa Post.dc.html:844` — the comp's own
 * five chips — because the design is the source of truth for what a reporter may say,
 * and a set that quietly grew a sixth member would be a product change made in a schema
 * file.
 *
 * The detail rule lives in `domain/` rather than in the zod input for the reason
 * `bulletin-content.policy.ts` gives: `bulletin.report` is a declared
 * `sync.submitMutations` mutation type (`sync/domain/mutation-type.ts:22`), so a bound
 * stated only at the tRPC boundary is a bound the offline path does not have.
 */
describe('report reason vocabulary', () => {
  it('is exactly the comp’s five chips, as stable wire codes', () => {
    expect(Object.values(REPORT_REASON)).toEqual([
      'harassment',
      'scam-or-fraud',
      'impersonation',
      'spam',
      'safety-risk',
    ]);
  });

  it('does not offer the legacy sentinel — it is readable, never writable', () => {
    expect(Object.values(REPORT_REASON)).not.toContain(LEGACY_REPORT_REASON);
  });
});

describe('validateReportDetail', () => {
  it('returns the trimmed value, which is what the caller must store', () => {
    expect(validateReportDetail('  They asked for my card number.  ')).toBe(
      'They asked for my card number.',
    );
  });

  it('refuses a detail that trims to nothing — the comp blocks Send without words', () => {
    expect(() => validateReportDetail('   ')).toThrow(ReportDetailInvalidError);
  });

  it('refuses an empty detail', () => {
    expect(() => validateReportDetail('')).toThrow(ReportDetailInvalidError);
  });

  it('accepts one exactly at the bound', () => {
    const detail = 'x'.repeat(REPORT_DETAIL_MAX_LENGTH);

    expect(validateReportDetail(detail)).toBe(detail);
  });

  it('refuses one longer than the bound', () => {
    expect(() => validateReportDetail('x'.repeat(REPORT_DETAIL_MAX_LENGTH + 1))).toThrow(
      ReportDetailInvalidError,
    );
  });

  it('measures the bound after trimming, so whitespace cannot exhaust the budget', () => {
    const detail = `  ${'x'.repeat(REPORT_DETAIL_MAX_LENGTH)}  `;

    expect(validateReportDetail(detail)).toHaveLength(REPORT_DETAIL_MAX_LENGTH);
  });

  it('carries a stable application code, not a generic bad request', () => {
    expect(() => validateReportDetail('')).toThrow(
      expect.objectContaining({ code: ReportDetailInvalidError.code }),
    );
  });
});
