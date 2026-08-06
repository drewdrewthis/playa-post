import { describe, expect, it, vi } from 'vitest';

// None of these exist yet — legible failure at this seam until the coder writes them.
import { createSubmitMutationsService } from '../../application/submit-mutations.service';
import type { MutationResultRepository } from '../../domain/mutation-result.repository';
import { MutationBatchTooLargeError } from '../../domain/sync.errors';

/**
 * **Not one of the 10 named feature-file scenarios** — `specs/features/offline-
 * replay.feature` has 3, `moderation-report-dismiss.feature` has 7. This test pins a
 * property the L4 dispatch brief calls out explicitly ("sync.submitMutations: max
 * batch 50") and ADR-0005's "Transport" section states as the envelope's hard bound,
 * but which no named scenario exercises. Recorded here rather than silently added to
 * the count, per the brief's own "Key behaviors tests must pin" list.
 *
 * A fake repository, not a mock: `MutationResultRepository` is sync's own port
 * (`coding.md`'s "don't mock what you own"), and nothing here asserts a call
 * sequence against it — only that dispatch never reaches a handler once the batch is
 * over the bound.
 */
describe('sync.submitMutations batch size (@unit, ADR-0005 "Transport": max 50)', () => {
  it('rejects a 51-envelope batch without invoking any handler', async () => {
    const fakeMutationResults: MutationResultRepository = {
      findByActorAndMutationId: async () => null,
      save: async () => undefined,
    };
    const handle = vi.fn();
    const submitMutations = createSubmitMutationsService({
      mutationResults: fakeMutationResults,
      handlers: { 'bulletin.create': { handle } },
      actorshipChecks: {},
    });

    const envelopes = Array.from({ length: 51 }, (_, index) => ({
      mutationId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      mutationType: 'bulletin.create',
      clientCreatedAt: new Date().toISOString(),
      payload: { type: 'request', title: 'x', body: 'y' },
    }));

    await expect(
      submitMutations.submit({ actorId: 'actor-1', envelopes }),
    ).rejects.toMatchObject({ code: MutationBatchTooLargeError.code });
    expect(handle).not.toHaveBeenCalled();
  });
});
