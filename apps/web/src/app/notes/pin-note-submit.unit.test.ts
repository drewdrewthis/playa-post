import { describe, expect, it } from 'vitest';

import type { OfflineDatabase, PendingMutationRow, PendingMutationState } from '../offline/database';
import type { SyncRunner } from '../offline/sync-runner';

import { NOTE_NOT_SAVED_MESSAGE, submitPinNote } from './pin-note-submit';

/**
 * Pressing Pin, and every way that press can fail.
 *
 * The store and the drainer are fakes holding real state — the queue is what this module
 * reads its answers off, so a mock that only recorded calls would assert nothing about the
 * one thing that matters: which row the screen ends up describing.
 */

/** An in-memory `pendingMutations`, optionally broken the way IndexedDB breaks. */
function fakeStore(fault: { readonly writes?: boolean; readonly reads?: boolean } = {}) {
  const rows = new Map<string, PendingMutationRow>();

  const database = {
    pendingMutations: {
      add(row: PendingMutationRow): Promise<string> {
        if (fault.writes === true) {
          return Promise.reject(new Error('QuotaExceededError'));
        }

        rows.set(row.mutationId, row);

        return Promise.resolve(row.mutationId);
      },
      get(mutationId: string): Promise<PendingMutationRow | undefined> {
        if (fault.reads === true) {
          return Promise.reject(new Error('InvalidStateError'));
        }

        return Promise.resolve(rows.get(mutationId));
      },
    },
  } as unknown as OfflineDatabase;

  return {
    database,
    queued: (): readonly PendingMutationRow[] => [...rows.values()],
    /** What a drain does to the queue, without the drainer. */
    settle(state: PendingMutationState, lastError: string | null = null): void {
      for (const [mutationId, row] of rows) {
        rows.set(mutationId, { ...row, state, lastError });
      }
    },
    /** What a drain that already synced and pruned this row on an earlier pass leaves behind: nothing (issue #180). */
    prune(mutationId: string): void {
      rows.delete(mutationId);
    },
  };
}

function fakeRunner(onDrain: () => void = () => undefined) {
  let drains = 0;

  return {
    runner: {
      drain(): Promise<void> {
        drains += 1;
        onDrain();

        return Promise.resolve();
      },
    } satisfies SyncRunner,
    drains: (): number => drains,
  };
}

const REJECTING_RUNNER: SyncRunner = {
  drain: () => Promise.reject(new TypeError('Failed to fetch')),
};

describe('submitPinNote', () => {
  describe('when everything works', () => {
    it('reports the pin in the comp’s words and leaves the screen', async () => {
      const store = fakeStore();
      const drainer = fakeRunner(() => {
        store.settle('synced');
      });

      const result = await submitPinNote({
        database: store.database,
        syncRunner: drainer.runner,
        recipientId: 'person-1',
        body: 'Come find me at the pavilion.',
        recipientName: 'Lena',
      });

      expect(result.kind).toBe('pinned');
      expect(result.message).toBe('Pinned to Lena’s board — only they see it');
      expect(result.stays).toBe(false);
      expect(store.queued()).toHaveLength(1);
    });

    it('queues the trimmed note against the recipient it was given', async () => {
      const store = fakeStore();
      const drainer = fakeRunner(() => {
        store.settle('synced');
      });

      await submitPinNote({
        database: store.database,
        syncRunner: drainer.runner,
        recipientId: 'person-1',
        body: '  Come find me.  ',
        recipientName: null,
      });

      expect(store.queued()[0]).toMatchObject({
        mutationType: 'note.pin',
        payload: { recipientId: 'person-1', body: 'Come find me.' },
      });
    });
  });

  describe('when a drain elsewhere already synced and pruned the row before this reads it back', () => {
    /*
     * ⚠ The bug `pruneSyncedMutations` introduced (issue #180): before it existed, a row
     * this call just wrote and just drained could only be missing from the store if the
     * store itself was unreadable, and `pending` was the safe reading of that. Now a
     * mutationId this call minted can be missing because a drain — this one, an
     * overlapping one, or another tab's — already synced and swept it. Reading that as
     * still queued is what let a posted note be shown as "Queued", and worse, let a
     * second press mint a fresh envelope for a note the server already held.
     */
    it('reports the note as pinned, not queued', async () => {
      const store = fakeStore();
      const drainer = fakeRunner(() => {
        const [row] = store.queued();

        if (row) {
          store.prune(row.mutationId);
        }
      });

      const result = await submitPinNote({
        database: store.database,
        syncRunner: drainer.runner,
        recipientId: 'person-1',
        body: 'Come find me.',
        recipientName: 'Lena',
      });

      expect(result.kind).toBe('pinned');
      expect(result.message).toBe('Pinned to Lena’s board — only they see it');
    });

    it('hands back no mutationId, so a next press cannot mint a duplicate envelope over it', async () => {
      const store = fakeStore();
      const drainer = fakeRunner(() => {
        const [row] = store.queued();

        if (row) {
          store.prune(row.mutationId);
        }
      });

      const result = await submitPinNote({
        database: store.database,
        syncRunner: drainer.runner,
        recipientId: 'person-1',
        body: 'Come find me.',
        recipientName: null,
      });

      expect(result.mutationId).toBeNull();
    });
  });

  describe('when the queue write itself fails', () => {
    /*
     * ⚠ The failure that used to leave the form disabled forever with nothing on screen.
     * Nothing was recorded, so this is not a refusal — no server saw the note — and the
     * remedy really is to press again.
     */
    it('says the note is not saved, and gives the form back', async () => {
      const store = fakeStore({ writes: true });
      const drainer = fakeRunner();

      const result = await submitPinNote({
        database: store.database,
        syncRunner: drainer.runner,
        recipientId: 'person-1',
        body: 'Come find me.',
        recipientName: 'Lena',
      });

      expect(result).toEqual({
        kind: 'not-saved',
        message: NOTE_NOT_SAVED_MESSAGE,
        mutationId: null,
        stays: true,
      });
    });

    it('does not describe it as the server refusing anything', () => {
      expect(NOTE_NOT_SAVED_MESSAGE).not.toContain('server');
      expect(NOTE_NOT_SAVED_MESSAGE).not.toContain('refus');
    });

    it('does not drain over a write that never landed', async () => {
      const store = fakeStore({ writes: true });
      const drainer = fakeRunner();

      await submitPinNote({
        database: store.database,
        syncRunner: drainer.runner,
        recipientId: 'person-1',
        body: 'Come find me.',
        recipientName: null,
      });

      expect(drainer.drains()).toBe(0);
    });
  });

  describe('when the drain fails after the note is queued', () => {
    /*
     * ⚠ The drain covers every queued row, so its failure is not this note's answer. The
     * row is written, the badge accounts for it, and the honest thing to say is what the
     * row says — which is that it is queued.
     */
    it('renders the row’s real state rather than rejecting', async () => {
      const store = fakeStore();

      const result = await submitPinNote({
        database: store.database,
        syncRunner: REJECTING_RUNNER,
        recipientId: 'person-1',
        body: 'Come find me.',
        recipientName: 'Lena',
      });

      expect(result.kind).toBe('queued');
      expect(result.message).toBe('Queued — will sync when you’re back');
      expect(result.stays).toBe(false);
    });

    it('hands the queued row back, so a second press has something to replay', async () => {
      const store = fakeStore();

      const result = await submitPinNote({
        database: store.database,
        syncRunner: REJECTING_RUNNER,
        recipientId: 'person-1',
        body: 'Come find me.',
        recipientName: null,
      });

      expect(result.mutationId).toBe(store.queued()[0]?.mutationId);
    });
  });

  describe('a second press', () => {
    /*
     * ⚠ **Never a second note.** The server tells a replay from a duplicate by the
     * `mutationId` and the payload hash, so a retry that minted a fresh envelope would be
     * a genuinely new write that nothing on either side could recognise as the same one.
     */
    it('replays the row already queued rather than writing another', async () => {
      const store = fakeStore();

      const first = await submitPinNote({
        database: store.database,
        syncRunner: REJECTING_RUNNER,
        recipientId: 'person-1',
        body: 'Come find me.',
        recipientName: null,
      });

      const drainer = fakeRunner(() => {
        store.settle('synced');
      });

      const second = await submitPinNote({
        database: store.database,
        syncRunner: drainer.runner,
        recipientId: 'person-1',
        body: 'Come find me.',
        recipientName: 'Lena',
        queuedMutationId: first.mutationId,
      });

      expect(store.queued()).toHaveLength(1);
      expect(drainer.drains()).toBe(1);
      expect(second.kind).toBe('pinned');
    });

    /*
     * A row the server has already judged is one no further drain will claim — the drainer
     * takes `pending` and nothing else. Pressing again over it has to be a fresh envelope,
     * or the button does nothing at all.
     */
    it('writes a fresh envelope over a row the server already refused', async () => {
      const store = fakeStore();

      const first = await submitPinNote({
        database: store.database,
        syncRunner: fakeRunner(() => {
          store.settle('failed', 'NOTE_CONTENT_INVALID');
        }).runner,
        recipientId: 'person-1',
        body: 'Come find me.',
        recipientName: null,
      });

      expect(first.kind).toBe('refused');
      expect(first.stays).toBe(true);
      // Nothing to replay, so the screen is told to start over rather than press a button
      // that could not move the row.
      expect(first.mutationId).toBeNull();

      const second = await submitPinNote({
        database: store.database,
        syncRunner: fakeRunner().runner,
        recipientId: 'person-1',
        body: 'Come find me, second try.',
        recipientName: null,
        queuedMutationId: null,
      });

      expect(store.queued()).toHaveLength(2);
      expect(second.kind).toBe('queued');
    });
  });

  describe('when the server refuses the note', () => {
    it('keeps the screen, and answers with the requirement rather than a fact about them', async () => {
      const store = fakeStore();
      const drainer = fakeRunner(() => {
        store.settle('failed', 'NOTE_RECIPIENT_UNREACHABLE');
      });

      const result = await submitPinNote({
        database: store.database,
        syncRunner: drainer.runner,
        recipientId: 'person-1',
        body: 'Come find me.',
        recipientName: 'Lena',
      });

      expect(result.kind).toBe('refused');
      expect(result.stays).toBe(true);
      expect(result.message).not.toContain('Lena');
    });
  });

  /*
   * ⚠ Totality is the contract. Anything this rejects with leaves the compose form
   * disabled forever with nothing said — the one outcome worse than every failure above.
   */
  it('still answers when the store cannot be read at all', async () => {
    const store = fakeStore({ reads: true });

    const result = await submitPinNote({
      database: store.database,
      syncRunner: REJECTING_RUNNER,
      recipientId: 'person-1',
      body: 'Come find me.',
      recipientName: null,
    });

    expect(result.kind).toBe('queued');
    expect(result.stays).toBe(false);
  });
});
