import { useQuery } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent, type JSX } from 'react';
import { Link, useNavigate } from 'react-router';

import { useApi } from '../api/api-provider';
import { GRAPH_LIST_QUERY_KEY } from '../graph/graph-query-keys';
import { useOffline } from '../offline/offline-provider';

import {
  composeNoteTitle,
  notePrivacyLine,
  noteRecipientName,
  pinNoteButtonLabel,
} from './note-recipient';
import { inspectNoteDraft, NOTE_BODY_MAX_LENGTH, noteOverBy } from './pin-note-draft';
import { submitPinNote } from './pin-note-submit';

import '../bulletins/compose-bulletin.css';

/**
 * How long the success toast is on screen before the board replaces it.
 *
 * The same hold as `routes/compose-bulletin.tsx`, for the same reason — here too the
 * toast and the board are two screens rather than a sheet closing onto the board behind
 * it. The two must agree: they are the same gesture, reached from the same button.
 */
const TOAST_HOLD_MS = 1200;

/** `navigator.onLine`, as state, so the submit button can name what happens next. */
function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);

  useEffect(() => {
    const update = (): void => {
      setOnline(navigator.onLine);
    };

    window.addEventListener('online', update);
    window.addEventListener('offline', update);

    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  return online;
}

/**
 * Compose a note — the comp's compose sheet in its `isNote` shape
 * (`design/Playa Post.dc.html:387-391`), reached as `/board/new?noteTo=<personId>`.
 *
 * **One textarea, and the absences are the design.** No type, no title, no location, no
 * audience, no expiry: a note has exactly one recipient, decided before this screen
 * opened, and PDF §6 keeps fixed-recipient messaging out of the bulletin model rather
 * than folding it in as a seventh type (decision D6). Every control the bulletin sheet
 * has is a control this one must not grow.
 *
 * ⚠ **Always through the offline queue**, online or not — `routes/compose-bulletin.tsx`
 * says why at length, and `note.pin` has a real handler behind `sync.submitMutations`, so
 * a duplicate submission of the same envelope comes back `replayed` and leaves one note.
 *
 * ⚠ **No client-side degree check, deliberately.** Whether this recipient may be written
 * to is decided inside the insert statement, and it is decided identically for a
 * second-degree person, a stranger, and a UUID naming nobody. A gate here would answer
 * that question locally — which is the "can I write to this person" probe
 * `packages/contracts/src/notes.ts` forbids building. The screen submits and renders what
 * the server said.
 *
 * **The screen only leaves on a success.** A refusal keeps the typed note on screen and
 * says what the server said; the refused row stays in the queue, where the shell's
 * pending badge accounts for it. A note that never reached the queue at all says *that*,
 * and gives the button back — the one thing the screen may never do is stay disabled with
 * nothing on it.
 *
 * The submit itself is `pin-note-submit.ts`: which row this press acts on, and what its
 * settled state means, are decisions that can be asserted without a DOM, so they are not
 * made in here.
 */
export function ComposeNote({ recipientId }: { readonly recipientId: string }): JSX.Element {
  const api = useApi();
  const navigate = useNavigate();
  const online = useOnline();
  const { database, syncRunner } = useOffline();
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  /*
   * The row an earlier press left in the queue, or `null`. Held across presses so a
   * second one replays the write that exists rather than minting a second envelope —
   * `pin-note-submit.ts` decides which of those this is, and is the only thing that sets
   * it back to `null`.
   */
  const [queuedMutationId, setQueuedMutationId] = useState<string | null>(null);

  /*
   * The recipient's name, from the graph the app is already holding. A miss — an
   * unknown id, a withheld identity, a read still in flight — is not an error state:
   * every sentence on this screen has a form that does not need a name, because §6a
   * means one may genuinely not exist. Nothing here waits for it.
   */
  const graph = useQuery({
    queryKey: GRAPH_LIST_QUERY_KEY,
    queryFn: () => api.query('graph.list', undefined),
  });

  const name = noteRecipientName(
    graph.data?.people.find((person) => person.userId === recipientId),
  );

  const issues = inspectNoteDraft(body);
  const over = issues.body === 'too-long';

  // Setting the toast is what schedules the departure, so there is one place where "it
  // worked" is decided. Clearing the timer on unmount keeps a fast Close from navigating
  // a screen the user has already left.
  useEffect(() => {
    if (toast === null) {
      return;
    }

    const timer = setTimeout(() => {
      void navigate('/board');
    }, TOAST_HOLD_MS);

    return () => {
      clearTimeout(timer);
    };
  }, [toast, navigate]);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (!issues.pinnable || submitting) {
      return;
    }

    setSubmitting(true);
    setRefusal(null);

    // Every failure the queue, the network, and the store can produce has a sentence in
    // `pin-note-submit.ts`, and that call never rejects — which is what keeps `submitting`
    // from latching on with nothing on screen to explain it.
    const result = await submitPinNote({
      database,
      syncRunner,
      recipientId,
      body,
      recipientName: name,
      queuedMutationId,
    });

    setQueuedMutationId(result.mutationId);

    if (result.stays) {
      setRefusal(result.message);
      setSubmitting(false);
      return;
    }

    setToast(result.message);
  }

  return (
    <section className="compose-screen" data-testid="compose-note">
      <form
        className="compose-sheet"
        onSubmit={(event) => {
          void onSubmit(event);
        }}
      >
        <div className="compose-sheet__header">
          <h1 className="compose-sheet__title">{composeNoteTitle(name)}</h1>
          <Link className="compose-sheet__close" to="/board" data-testid="compose-note-close-link">
            Close
          </Link>
        </div>

        {/*
         * The comp's privacy line, and the closest thing this screen has to an audience
         * control: it states who sees the note rather than offering a choice, because
         * there is no choice — one recipient, decided by the button that opened this.
         *
         * ⚠ Its own class rather than `screen__aside`. This is not small print: it is the
         * sentence that tells somebody their message is private, and the comp gives it
         * `t.sub` at 12.5px rather than the 11px faint treatment the asides get.
         */}
        <p
          className="compose-sheet__privacy"
          id="compose-note-privacy"
          data-testid="compose-note-privacy"
        >
          {notePrivacyLine(name)}
        </p>

        <div className="form__field">
          <label className="form__label" htmlFor="compose-note-body">
            Your note
          </label>

          <textarea
            id="compose-note-body"
            className="form__input form__input--prose form__input--multiline"
            data-testid="compose-note-body-input"
            name="body"
            rows={3}
            placeholder="Say what you need, and how they can reach you back…"
            value={body}
            aria-describedby={
              over ? 'compose-note-privacy compose-note-length' : 'compose-note-privacy'
            }
            aria-invalid={over}
            onChange={(event) => setBody(event.target.value)}
          />

          {/*
           * Only when it is over. The bulletin sheet counts every keystroke because it
           * has four budgets to spend; a note has one, and a running counter under a
           * private message reads as somebody watching you write it.
           */}
          {over ? (
            <p className="form__error" id="compose-note-length">
              {NOTE_BODY_MAX_LENGTH} characters at most — {noteOverBy(body)} over.
            </p>
          ) : null}
        </div>

        {refusal === null ? null : (
          <p className="form__error" data-testid="compose-note-error" role="alert">
            {refusal}
          </p>
        )}

        <button
          className="button button--primary"
          data-testid="compose-note-submit-button"
          type="submit"
          disabled={!issues.pinnable || submitting}
        >
          {pinNoteButtonLabel(name, online)}
        </button>
      </form>

      {toast === null ? null : (
        <p className="compose-toast" data-testid="compose-note-toast" role="status">
          {toast}
        </p>
      )}
    </section>
  );
}
