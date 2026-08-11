// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import type { IntroInboxRow, IntroPerson } from '@playa-post/contracts';

import {
  allElements,
  createFakeApi,
  mountWithApi,
  requireElement,
  setFieldValue,
  type FakeApi,
  type MountedTree,
} from '../testing/mount-with-api';

import { IntroInbox } from './intro-inbox';
import { INTRO_NOTE_MAX_LENGTH } from './intro-note-draft';

/**
 * The dual-role intro inbox at the top of `/graph` (issues #89, #175 and #166).
 *
 * ⚠ jsdom, by the per-file pragma above: the `unit` project runs in `node`.
 *
 * Two shapes, and each has rules the other must not acquire. A `via` row's Pass on opens a
 * **required** note field and submits the decision and the note together (#175); a
 * `target` row renders **two** notes under **two** authors' cards and answers a different
 * procedure — `intros.respond`, accept or decline, one press and no field (#166). The
 * cross-checks below are the load-bearing ones: a control that appeared on the wrong row
 * would submit an action the server refuses, and a decline that reached `intros.decide`
 * would answer somebody else's ask.
 */

const LENA: IntroPerson = { userId: 'lena-id', disclosure: 'full', displayName: 'Lena' };
const KIKI: IntroPerson = { userId: 'kiki-id', disclosure: 'full', displayName: 'Kiki' };
const BRAM: IntroPerson = { userId: 'bram-id', disclosure: 'full', displayName: 'Bram' };
const WITHHELD_REQUESTER: IntroPerson = { userId: 'ghost-4b21', disclosure: 'topology_only' };
const WITHHELD_VIA: IntroPerson = { userId: 'ghost-9c07', disclosure: 'topology_only' };

const VIA_ROW: IntroInboxRow = {
  id: 'request-1',
  role: 'via',
  note: 'We both ride at dawn.',
  createdAt: '2026-08-10T09:00:00.000Z',
  requester: LENA,
  target: KIKI,
};

const TARGET_ROW: IntroInboxRow = {
  id: 'request-2',
  role: 'target',
  note: 'I heard you fix bikes.',
  viaNote: 'She rebuilt my whole drivetrain in a dust storm.',
  createdAt: '2026-08-10T10:00:00.000Z',
  requester: LENA,
  via: BRAM,
};

let tree: MountedTree | null = null;

afterEach(async () => {
  const mountedTree = tree;

  tree = null;

  if (mountedTree !== null) {
    await mountedTree.unmount();
  }
});

async function mountInbox(
  rows: readonly IntroInboxRow[],
  decide: (input: unknown) => unknown = () => ({}),
  respond: (input: unknown) => unknown = () => ({}),
): Promise<FakeApi> {
  const api = createFakeApi({
    'intros.listInbox': () => rows,
    'intros.decide': decide,
    'intros.respond': respond,
  });

  tree = await mountWithApi(<IntroInbox />, api);

  return api;
}

function mounted(): MountedTree {
  if (tree === null) {
    throw new Error('the inbox is not mounted');
  }

  return tree;
}

/** Press a control by test id, and let the render that follows land. */
async function press(testId: string): Promise<void> {
  await mounted().run(() => {
    requireElement(mounted().container, `[data-testid="${testId}"]`).click();
  });
}

/** Write the via's own note into the field Pass on reveals (#175). */
async function writeViaNote(text: string): Promise<void> {
  await mounted().run(() => {
    setFieldValue(
      requireElement<HTMLTextAreaElement>(
        mounted().container,
        '[data-testid="intro-via-note-input"]',
      ),
      text,
    );
  });
}

describe('the intro inbox', () => {
  /*
   * The graph screen's subject is the network. An empty state here would put "no intros"
   * in front of everybody who has none, forever, on a screen that had nothing to say.
   */
  it('renders nothing at all when nothing is waiting', async () => {
    await mountInbox([]);

    expect(mounted().container.querySelector('[data-testid="intro-inbox"]')).toBeNull();
  });

  describe('a row this viewer was asked to act on', () => {
    it('names both other people, shows the note whole, and offers both decisions', async () => {
      await mountInbox([VIA_ROW]);

      const row = requireElement(mounted().container, '[data-testid="intro-inbox-via-row"]');

      expect(row.textContent).toContain('Lena');
      expect(row.textContent).toContain('Kiki');
      expect(row.textContent).toContain('We both ride at dawn.');
      expect(row.querySelector('[data-testid="intro-pass-on-button"]')).not.toBeNull();
      expect(row.querySelector('[data-testid="intro-decline-button"]')).not.toBeNull();
    });

    /*
     * ⚠ **Pass on opens a field; it does not decide anything** (#175). The decision and
     * the via's note are one submission because the server writes them in one statement —
     * a control that passed the intro on and *then* asked for words would leave a vouch
     * that could fail after the introduction was already made.
     */
    it('opens a required note field rather than deciding anything', async () => {
      const api = await mountInbox([VIA_ROW]);

      await press('intro-pass-on-button');

      expect(api.calls.filter((call) => call.kind === 'mutate')).toEqual([]);

      const container = mounted().container;
      const field = requireElement<HTMLTextAreaElement>(
        container,
        '[data-testid="intro-via-note-input"]',
      );

      // Focus follows the field into existence: without it a keyboard or screen-reader
      // user is left on a button whose label just changed, with a required field they
      // were never told about somewhere above it.
      expect(document.activeElement).toBe(field);
      // The label names who will read it — "for Kiki", because the note goes *to* the
      // target and a via who thinks they are annotating the app writes a worse sentence.
      expect(container.textContent).toContain('Add your own note for Kiki');
      expect(
        requireElement(container, '[data-testid="intro-pass-on-submit-button"]').getAttribute(
          'aria-disabled',
        ),
      ).toBe('true');
    });

    it('passes it on with the note, trimmed, once one is written', async () => {
      const api = await mountInbox([VIA_ROW]);

      await press('intro-pass-on-button');
      await writeViaNote('  They should meet at the tea camp.  ');
      await press('intro-pass-on-submit-button');

      expect(api.calls.filter((call) => call.kind === 'mutate')).toEqual([
        {
          kind: 'mutate',
          path: 'intros.decide',
          input: {
            introRequestId: 'request-1',
            decision: 'pass_on',
            note: 'They should meet at the tea camp.',
          },
        },
      ]);

      // The row will vanish on the re-read; the receipt is what says the decision took —
      // in a live region, because the presser's focus was on a button that just left.
      const confirmation = requireElement(
        mounted().container,
        '[data-testid="intro-inbox-confirmation"]',
      );

      expect(confirmation.textContent).toBe('Passed on.');
      expect(confirmation.getAttribute('role')).toBe('status');
    });

    it('will not submit a whitespace-only note, and says why in the field’s description', async () => {
      const api = await mountInbox([VIA_ROW]);

      await press('intro-pass-on-button');
      await writeViaNote('   ');
      await press('intro-pass-on-submit-button');

      // The click is guarded rather than the button being `disabled`: it stays focusable
      // and announced, so a screen-reader user hears the reason instead of tabbing past
      // the control they came to press (`report-abuse-sheet.tsx`'s rule).
      expect(api.calls.filter((call) => call.kind === 'mutate')).toEqual([]);

      const container = mounted().container;
      const submit = requireElement(container, '[data-testid="intro-pass-on-submit-button"]');

      expect(submit.getAttribute('aria-disabled')).toBe('true');
      expect(submit.hasAttribute('disabled')).toBe(false);

      // Resolved by walking ids rather than with a `#id` selector: `useId` produces ids
      // containing characters CSS treats as syntax, and `aria-describedby` is a
      // space-separated list — so a selector would be both invalid and incomplete.
      const describedBy = (submit.getAttribute('aria-describedby') ?? '').split(' ');
      const description = allElements(container, '[id]')
        .filter((element) => describedBy.includes(element.id))
        .map((element) => element.textContent)
        .join(' ');

      expect(description).toContain('a note of your own is required');
    });

    it('marks an over-long note invalid and refuses to send it', async () => {
      const api = await mountInbox([VIA_ROW]);

      await press('intro-pass-on-button');
      await writeViaNote('x'.repeat(INTRO_NOTE_MAX_LENGTH + 12));
      await press('intro-pass-on-submit-button');

      expect(api.calls.filter((call) => call.kind === 'mutate')).toEqual([]);

      const container = mounted().container;

      expect(
        requireElement(container, '[data-testid="intro-via-note-input"]').getAttribute(
          'aria-invalid',
        ),
      ).toBe('true');
      // The over-by count, so the writer knows how much to cut rather than only that it
      // is too much. Measured after trimming, exactly as the server measures it.
      expect(container.textContent).toContain('12 over');
    });

    /*
     * ⚠ Declining sends no reason, because the wire carries none — the via's rationale is
     * theirs, and a field for it would turn a private judgement into something the
     * requester could be shown.
     */
    it('declines with the decision and nothing else', async () => {
      const api = await mountInbox([VIA_ROW]);

      await press('intro-decline-button');

      expect(api.calls.filter((call) => call.kind === 'mutate')).toEqual([
        {
          kind: 'mutate',
          path: 'intros.decide',
          input: { introRequestId: 'request-1', decision: 'decline' },
        },
      ]);

      expect(
        requireElement(mounted().container, '[data-testid="intro-inbox-confirmation"]')
          .textContent,
      ).toBe('Declined.');
    });

    it('offers no note field beside Decline, even with the pass-on form open', async () => {
      const api = await mountInbox([VIA_ROW]);

      // ⚠ Opening the pass-on form must not turn the decline into a "decline with a
      // reason". The wire's strict decline shape refuses a note on a decline because the
      // requester is told only that it was not passed on — so whatever is in the field,
      // declining sends the decision alone.
      await press('intro-pass-on-button');
      await writeViaNote('Not for you, sorry.');
      await press('intro-decline-button');

      expect(api.calls.filter((call) => call.kind === 'mutate')).toEqual([
        {
          kind: 'mutate',
          path: 'intros.decide',
          input: { introRequestId: 'request-1', decision: 'decline' },
        },
      ]);
    });

    // An absent card is what the wire sends when the request outlived the relationship
    // that carried it. It renders as no name — never one rebuilt from the id.
    it('renders a withheld requester with no name and no identifier', async () => {
      await mountInbox([{ ...VIA_ROW, requester: WITHHELD_REQUESTER }]);

      const container = mounted().container;

      expect(
        requireElement(container, '[data-testid="intro-inbox-via-row"]').textContent,
      ).toContain('Private connection');
      expect(container.innerHTML).not.toContain(WITHHELD_REQUESTER.userId);
    });
  });

  describe('a row that is an introduction already made to this viewer', () => {
    /*
     * ⚠ Branching on `role` is a rule, not a layout preference: the server refuses a
     * *decision* from anybody but the named via, so Pass on here would be a control whose
     * only outcome is `INTRO_UNAVAILABLE`. What this row offers instead is the target's own
     * pair of answers (#166), which reach a different procedure entirely.
     */
    it('shows who was introduced, their note, and the target’s own two answers', async () => {
      await mountInbox([TARGET_ROW]);

      const row = requireElement(mounted().container, '[data-testid="intro-inbox-target-row"]');

      expect(row.textContent).toContain('Lena');
      expect(row.textContent).toContain('I heard you fix bikes.');
      expect(row.querySelector('[data-testid="intro-accept-button"]')).not.toBeNull();
      expect(row.querySelector('[data-testid="intro-target-decline-button"]')).not.toBeNull();

      // ⚠ And none of the via's controls. `intro-decline-button` is deliberately a
      // different id from `intro-target-decline-button`: one answers somebody else's ask
      // and the other answers an introduction, and a shared id would let a walk that meant
      // one silently press the other.
      expect(row.querySelector('[data-testid="intro-pass-on-button"]')).toBeNull();
      expect(row.querySelector('[data-testid="intro-decline-button"]')).toBeNull();
    });

    /*
     * ⚠ **Load-bearing copy, not decoration.** An introduction arrives from somebody the
     * reader knows, about somebody they do not, and the pressure to be polite is what
     * turns an intro product into an obligation. Saying plainly that a refusal reaches
     * nobody is what makes "no" a real option.
     */
    it('says what each answer does, and that declining tells nobody', async () => {
      await mountInbox([TARGET_ROW]);

      const row = requireElement(mounted().container, '[data-testid="intro-inbox-target-row"]');

      expect(row.textContent).toContain('Accepting connects you');
      expect(row.textContent).toContain('Declining tells nobody');
    });

    it('accepts in one press, with no note field and nothing else on the wire', async () => {
      const api = await mountInbox([TARGET_ROW]);

      await press('intro-accept-button');

      expect(api.calls.filter((call) => call.kind === 'mutate')).toEqual([
        {
          kind: 'mutate',
          path: 'intros.respond',
          input: { introRequestId: 'request-2', response: 'accept' },
        },
      ]);

      // ⚠ The confirmation does not claim the connection already exists. The server
      // records the answer and forms the edge from it moments later (decision D12), so
      // "you are now connected" would be false for as long as that takes and would send
      // somebody to a graph that has not caught up.
      const confirmation = requireElement(
        mounted().container,
        '[data-testid="intro-inbox-confirmation"]',
      );

      expect(confirmation.textContent).toContain('being connected');
      expect(confirmation.getAttribute('role')).toBe('status');
    });

    it('declines in one press, and says who was told', async () => {
      const api = await mountInbox([TARGET_ROW]);

      await press('intro-target-decline-button');

      expect(api.calls.filter((call) => call.kind === 'mutate')).toEqual([
        {
          kind: 'mutate',
          path: 'intros.respond',
          input: { introRequestId: 'request-2', response: 'decline' },
        },
      ]);

      // The answer is "nobody", and it is the piece of information that makes the control
      // safe to press — so it is on screen after the press as well as before it.
      expect(
        requireElement(mounted().container, '[data-testid="intro-inbox-confirmation"]').textContent,
      ).toContain('Nobody is told');
    });

    it('never reaches intros.decide, whichever answer is pressed', async () => {
      // ⚠ The regression this pins: `intros.decide`'s `decline` and `intros.respond`'s
      // `decline` are the same word for two different acts by two different people. A
      // target row wired to the via's mutation would answer somebody else's ask — and
      // would be refused by the server for a reason no message here could explain.
      for (const control of ['intro-accept-button', 'intro-target-decline-button']) {
        const api = await mountInbox([TARGET_ROW]);

        await press(control);

        expect(
          api.calls.filter((call) => call.kind === 'mutate').map((call) => call.path),
        ).toEqual(['intros.respond']);

        await mounted().unmount();
        tree = null;
      }
    });

    it('says an answer was refused without explaining why', async () => {
      await mountInbox([TARGET_ROW], undefined, () => {
        throw Object.assign(new Error('refused'), {
          data: { code: 'NOT_FOUND', applicationCode: 'INTRO_UNAVAILABLE' },
        });
      });

      await press('intro-accept-button');

      // ⚠ One flat sentence for every reason — including "the via declined it", which is
      // the case a message here must never distinguish. Elaborating would let a target
      // detect a decline by trying to accept.
      expect(
        requireElement(mounted().container, '[data-testid="intro-inbox-error"]').textContent,
      ).toBe('That introduction is not available.');
    });

    /*
     * ⚠ **Two notes by two people, each under its own author's card** (#175). Attributing
     * the via's vouch to the requester would put words in the mouth of the person being
     * vouched for — which is the one misreading this screen must not permit — so the
     * notes are two elements with two ledes rather than one joined paragraph.
     */
    it('renders both notes, each under its own author', async () => {
      await mountInbox([TARGET_ROW]);

      const row = requireElement(mounted().container, '[data-testid="intro-inbox-target-row"]');
      const requesterNote = requireElement(row, '[data-testid="intro-inbox-requester-note"]');
      const viaNote = requireElement(row, '[data-testid="intro-inbox-via-note"]');

      expect(requesterNote.textContent).toBe('I heard you fix bikes.');
      expect(viaNote.textContent).toBe('She rebuilt my whole drivetrain in a dust storm.');
      expect(requesterNote).not.toBe(viaNote);

      // Both names present, and the via's sentence says what they did with it.
      expect(row.textContent).toContain('Bram');
      expect(row.textContent).toContain('Bram passed it on:');
    });

    it('renders the requester’s half alone when the pass-on predates the requirement', async () => {
      // An introduction passed on before #175 asked for a note carries none, and there is
      // no placeholder for it: an empty quote attributed to somebody is worse than a note
      // they never wrote.
      const { viaNote: _viaNote, ...beforeTheRule } = TARGET_ROW;

      await mountInbox([beforeTheRule]);

      const row = requireElement(mounted().container, '[data-testid="intro-inbox-target-row"]');

      expect(row.querySelector('[data-testid="intro-inbox-requester-note"]')).not.toBeNull();
      expect(row.querySelector('[data-testid="intro-inbox-via-note"]')).toBeNull();
      expect(row.textContent).not.toContain('passed it on:');
    });

    it('keeps the vouch and drops the name when the via is withheld', async () => {
      // The card is projected on every read, so a via who deactivated after passing it on
      // arrives withheld — and the words stay, because they were written and delivered.
      await mountInbox([{ ...TARGET_ROW, via: WITHHELD_VIA }]);

      const container = mounted().container;
      const row = requireElement(container, '[data-testid="intro-inbox-target-row"]');

      expect(
        requireElement(row, '[data-testid="intro-inbox-via-note"]').textContent,
      ).toBe('She rebuilt my whole drivetrain in a dust storm.');
      expect(row.textContent).toContain('Private connection');
      expect(container.innerHTML).not.toContain(WITHHELD_VIA.userId);
    });

    it('sits beside an ask without either row borrowing the other’s controls', async () => {
      await mountInbox([VIA_ROW, TARGET_ROW]);

      const container = mounted().container;

      expect(allElements(container, '[data-testid="intro-inbox-via-row"]')).toHaveLength(1);
      expect(allElements(container, '[data-testid="intro-inbox-target-row"]')).toHaveLength(1);
      expect(allElements(container, '[data-testid="intro-pass-on-button"]')).toHaveLength(1);
      // One of each answer, on the one row entitled to it — the two roles on screen
      // together is the arrangement where a shared component would show.
      expect(allElements(container, '[data-testid="intro-accept-button"]')).toHaveLength(1);
      expect(
        allElements(container, '[data-testid="intro-target-decline-button"]'),
      ).toHaveLength(1);
    });
  });

  it('says a decision was refused without explaining why', async () => {
    await mountInbox([VIA_ROW], () => {
      throw Object.assign(new Error('refused'), {
        data: { code: 'NOT_FOUND', applicationCode: 'INTRO_UNAVAILABLE' },
      });
    });

    await press('intro-pass-on-button');
    await writeViaNote('They should meet at the tea camp.');
    await press('intro-pass-on-submit-button');

    expect(
      requireElement(mounted().container, '[data-testid="intro-inbox-error"]').textContent,
    ).toBe('That introduction is not available.');
  });

  it('drops a stale refusal when the other role’s answer starts', async () => {
    // ⚠ The two roles share one refusal line. A via-row failure left on screen under a
    // later target-row confirmation would read as that answer's outcome — so starting
    // either mutation clears the other's error, and this pins it with both rows mounted.
    await mountInbox(
      [VIA_ROW, TARGET_ROW],
      () => {
        throw Object.assign(new Error('refused'), {
          data: { code: 'NOT_FOUND', applicationCode: 'INTRO_UNAVAILABLE' },
        });
      },
      () => ({}),
    );

    await press('intro-pass-on-button');
    await writeViaNote('They should meet at the tea camp.');
    await press('intro-pass-on-submit-button');

    expect(
      requireElement(mounted().container, '[data-testid="intro-inbox-error"]').textContent,
    ).toBe('That introduction is not available.');

    await press('intro-accept-button');

    const container = mounted().container;

    expect(container.querySelector('[data-testid="intro-inbox-error"]')).toBeNull();
    expect(
      requireElement(container, '[data-testid="intro-inbox-confirmation"]').textContent,
    ).toContain('being connected');
  });
});
