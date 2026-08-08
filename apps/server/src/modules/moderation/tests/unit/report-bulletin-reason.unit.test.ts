import { describe, expect, it } from 'vitest';

import { createReportBulletinService } from '../../application/report-bulletin.service';
import type { HiddenBulletin } from '../../domain/hidden-bulletin';
import {
  CannotReportOwnBulletinError,
  ModerationTargetUnavailableError,
  ReportDetailInvalidError,
} from '../../domain/moderation.errors';
import type {
  HideBulletinWrite,
  ModerationRepository,
  ReportBulletinWrite,
} from '../../domain/moderation.repository';
import { REPORT_REASON } from '../../domain/report-reason';

/**
 * The reason a reporter gives has to survive the whole way to the repository — and it
 * must not be reachable at all by a caller who was never entitled to report.
 *
 * A **fake** repository rather than a mock: the assertions below are about the write
 * that was recorded, which is an artifact, and `verify(repo.report).calledWith(...)`
 * would pass just as happily against a service that recorded the wrong thing and then
 * discarded it.
 */
function fakeModeration(): ModerationRepository & { readonly writes: ReportBulletinWrite[] } {
  const writes: ReportBulletinWrite[] = [];

  return {
    writes,
    report(write: ReportBulletinWrite): Promise<HiddenBulletin> {
      writes.push(write);

      return Promise.resolve({
        bulletinId: write.bulletinId,
        viewerId: write.viewerId,
        hiddenAt: write.occurredAt,
      });
    },
    dismiss(write: HideBulletinWrite): Promise<HiddenBulletin> {
      return Promise.resolve({
        bulletinId: write.bulletinId,
        viewerId: write.viewerId,
        hiddenAt: write.occurredAt,
      });
    },
    findHiddenFor(): Promise<ReadonlySet<string>> {
      return Promise.resolve(new Set());
    },
  };
}

const AUTHOR_ID = '11111111-1111-4111-8111-111111111111';
const REPORTER_ID = '22222222-2222-4222-8222-222222222222';
const BULLETIN_ID = '33333333-3333-4333-8333-333333333333';

const visibleToAnyone = (): Promise<{ authorId: string } | null> =>
  Promise.resolve({ authorId: AUTHOR_ID });

describe('createReportBulletinService — the reason reaches persistence', () => {
  it('records the reason and the trimmed detail the reporter gave', async () => {
    const moderation = fakeModeration();
    const service = createReportBulletinService({
      moderation,
      findVisibleBulletin: visibleToAnyone,
    });

    await service.report({
      actorId: REPORTER_ID,
      bulletinId: BULLETIN_ID,
      reason: REPORT_REASON.scamOrFraud,
      detail: '  They asked me to wire money off-playa.  ',
    });

    expect(moderation.writes).toHaveLength(1);
    expect(moderation.writes[0]).toMatchObject({
      bulletinId: BULLETIN_ID,
      viewerId: REPORTER_ID,
      reason: 'scam-or-fraud',
      detail: 'They asked me to wire money off-playa.',
    });
  });

  it('refuses a detail that trims to nothing, and writes no row', async () => {
    const moderation = fakeModeration();
    const service = createReportBulletinService({
      moderation,
      findVisibleBulletin: visibleToAnyone,
    });

    await expect(
      service.report({
        actorId: REPORTER_ID,
        bulletinId: BULLETIN_ID,
        reason: REPORT_REASON.spam,
        detail: '   ',
      }),
    ).rejects.toBeInstanceOf(ReportDetailInvalidError);

    expect(moderation.writes).toHaveLength(0);
  });

  /*
   * ADR-0005 precedence rule 1, restated as a test because the ordering is the security
   * property and nothing else would catch a reordering: authorization is resolved before
   * the reason or the detail is even looked at. Validating first would let a caller with
   * no relationship to the bulletin tell "my detail was refused" apart from "that
   * bulletin is not available" — an existence oracle assembled out of two error codes.
   */
  it('answers an unauthorized caller with the target error even when the detail is also invalid', async () => {
    const moderation = fakeModeration();
    const service = createReportBulletinService({
      moderation,
      findVisibleBulletin: () => Promise.resolve(null),
    });

    await expect(
      service.report({
        actorId: REPORTER_ID,
        bulletinId: BULLETIN_ID,
        reason: REPORT_REASON.harassment,
        detail: '',
      }),
    ).rejects.toBeInstanceOf(ModerationTargetUnavailableError);

    expect(moderation.writes).toHaveLength(0);
  });

  it('answers the author with the own-bulletin error even when the detail is also invalid', async () => {
    const moderation = fakeModeration();
    const service = createReportBulletinService({
      moderation,
      findVisibleBulletin: visibleToAnyone,
    });

    await expect(
      service.report({
        actorId: AUTHOR_ID,
        bulletinId: BULLETIN_ID,
        reason: REPORT_REASON.harassment,
        detail: '',
      }),
    ).rejects.toBeInstanceOf(CannotReportOwnBulletinError);

    expect(moderation.writes).toHaveLength(0);
  });
});
