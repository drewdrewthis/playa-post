import { Fragment, useEffect, useState, type FormEvent, type JSX, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';

import { BULLETIN_TYPE, type BulletinType } from '@playa-post/contracts';

import { TYPE_CHIP_LABELS } from '../bulletins/board-query';
import {
  buildCreateBulletinPayload,
  BULLETIN_BODY_MAX_LENGTH,
  BULLETIN_LOC_MAX_LENGTH,
  BULLETIN_TITLE_MAX_LENGTH,
  DEFAULT_EXPIRY_PRESET,
  EXPIRY_PRESETS,
  inspectBulletinDraft,
  type DraftFieldIssue,
  type ExpiryPreset,
} from '../bulletins/compose-bulletin-draft';
import { submitBulletin } from '../bulletins/submit-bulletin';
import { ComposeNote } from '../notes/compose-note';
import { noteRecipientParam } from '../notes/note-recipient';
import { useOffline } from '../offline/offline-provider';

import '../bulletins/compose-bulletin.css';

const BULLETIN_TYPES: readonly BulletinType[] = Object.values(BULLETIN_TYPE);

/**
 * How long the success toast is on screen before the board replaces it.
 *
 * The comp keeps its toast for 2400ms, but the comp's sheet closes onto the board it was
 * already covering — here the toast and the board are two screens. Long enough to read a
 * six-word pill, short enough that nobody wonders whether the button worked.
 */
const TOAST_HOLD_MS = 1200;

/**
 * `/board/new` — one route, two things you can write.
 *
 * `?noteTo=<personId>` is the whole switch, and it is a *route* parameter rather than a
 * mode toggle inside one form because the two compose different things: the note sheet
 * has one field and the bulletin sheet has six controls, and the recipient is decided
 * before either opens (the comp's `noteTo`, set by the button that navigates here).
 * Nothing offers to turn one into the other mid-draft.
 *
 * ⚠ **Dispatched here rather than branched inside the form.** The bulletin form holds
 * eight hooks; a `?noteTo` check above them would make every one of them conditional,
 * which React forbids and the linter catches. Two components, one route.
 */
export function ComposeBulletinRoute(): JSX.Element {
  const [searchParams] = useSearchParams();
  // Absent, empty, or nothing but spaces is not a recipient — `noteRecipientParam` owns
  // that reading, and hands back the trimmed id the note sheet is opened for.
  const noteTo = noteRecipientParam(searchParams.get('noteTo'));

  return noteTo === null ? (
    <ComposeBulletinForm />
  ) : (
    // A new recipient is a new sheet: no typed draft may survive a subject change.
    <ComposeNote key={noteTo} recipientId={noteTo} />
  );
}

/**
 * Compose a bulletin — the comp's "Post a bulletin" sheet.
 *
 * ⚠ **Always through the offline queue**, online or not. Posting straight to the
 * network when the device happens to be connected would make the queued path the
 * rarely-exercised one, and a replay route that only runs on a bad network is a replay
 * route nobody has tested. The drain immediately afterwards is what makes the
 * connected case feel immediate.
 *
 * `bulletin.create` has a real handler behind `sync.submitMutations`, so a duplicate
 * submission of the same envelope comes back `replayed` and produces exactly one
 * bulletin.
 *
 * **The screen only leaves on a success.** Where it used to navigate unconditionally, it
 * now reads the settled queue row back and stays put on a refusal, showing what the
 * server said. The submit itself is `submit-bulletin.ts`: what an absent row after a
 * drain means, and what to say about the row that settled, are decisions that can be
 * asserted without a DOM, so they are not made in here. A refused row stays in the queue
 * rather than being deleted — it is a write somebody made, the shell's pending badge is
 * the surface for it, and clearing it here would be this screen quietly discarding it.
 *
 * This is a route rather than the comp's overlay because the FAB navigates to
 * `/board/new`; it takes the sheet's shape without taking the router's. Turning it into a
 * true overlay is a change to the shell and the router, not to this file.
 */
function ComposeBulletinForm(): JSX.Element {
  const navigate = useNavigate();
  const { database, syncRunner } = useOffline();
  const [type, setType] = useState<BulletinType>(BULLETIN_TYPE.request);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [loc, setLoc] = useState('');
  const [expiry, setExpiry] = useState<ExpiryPreset>(DEFAULT_EXPIRY_PRESET);
  const [submitting, setSubmitting] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const issues = inspectBulletinDraft({ type, title, body, loc, expiry });

  // Setting the toast is what schedules the departure, so there is one place where
  // "it worked" is decided. Clearing the timer on unmount keeps a fast Close from
  // navigating a screen the user has already left.
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

    if (!issues.postable || submitting) {
      return;
    }

    setSubmitting(true);
    setRefusal(null);

    const outcome = await submitBulletin({
      database,
      syncRunner,
      payload: buildCreateBulletinPayload({ type, title, body, loc, expiry }, new Date()),
    });

    if (outcome.kind === 'refused') {
      setRefusal(outcome.message);
      setSubmitting(false);
      return;
    }

    setToast(outcome.message);
  }

  return (
    <section className="compose-screen" data-testid="compose-bulletin">
      <form
        className="compose-sheet"
        onSubmit={(event) => {
          void onSubmit(event);
        }}
      >
        <div className="compose-sheet__header">
          <h1 className="compose-sheet__title">Post a bulletin</h1>
          <Link className="compose-sheet__close" to="/board" data-testid="compose-bulletin-close-link">
            Close
          </Link>
        </div>

        <label className="form__field">
          <span className="form__label">Type</span>
          <select
            className="form__input form__input--pill compose-type-select"
            data-testid="compose-bulletin-type-select"
            aria-label="Type"
            name="type"
            value={type}
            onChange={(event) => setType(event.target.value as BulletinType)}
          >
            {BULLETIN_TYPES.map((candidate) => (
              <option key={candidate} value={candidate}>
                {TYPE_CHIP_LABELS[candidate]}
              </option>
            ))}
          </select>
        </label>

        <ComposeField
          fieldId="compose-bulletin-title"
          label="Title"
          value={title}
          maxLength={BULLETIN_TITLE_MAX_LENGTH}
          issue={issues.title}
        >
          <input
            {...fieldAria('compose-bulletin-title', issues.title === 'too-long')}
            className="form__input form__input--prose"
            data-testid="compose-bulletin-title-input"
            name="title"
            placeholder="Short and typed beats long and lost"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </ComposeField>

        <ComposeField
          fieldId="compose-bulletin-loc"
          label="Where"
          value={loc}
          maxLength={BULLETIN_LOC_MAX_LENGTH}
          issue={issues.loc}
          optional
        >
          <input
            {...fieldAria('compose-bulletin-loc', issues.loc === 'too-long')}
            className="form__input"
            data-testid="compose-bulletin-loc-input"
            name="loc"
            placeholder="e.g. 7:30 & E, Center Camp"
            value={loc}
            onChange={(event) => setLoc(event.target.value)}
          />
        </ComposeField>

        <ComposeField
          fieldId="compose-bulletin-body"
          label="Details"
          value={body}
          maxLength={BULLETIN_BODY_MAX_LENGTH}
          issue={issues.body}
        >
          <textarea
            {...fieldAria('compose-bulletin-body', issues.body === 'too-long')}
            className="form__input form__input--prose form__input--multiline"
            data-testid="compose-bulletin-body-input"
            name="body"
            rows={3}
            placeholder="Details + how to reach you: WhatsApp, email, or “note my board”"
            value={body}
            onChange={(event) => setBody(event.target.value)}
          />
        </ComposeField>

        <div className="compose-groups">
          <fieldset className="compose-group">
            <legend className="compose-group__label">Who sees it</legend>

            <div className="compose-chips">
              <input
                className="compose-chip__input"
                data-testid="compose-bulletin-audience-fixed"
                type="radio"
                id="compose-audience-graph"
                name="audience"
                checked
                disabled
              />
              <label className="compose-chip" htmlFor="compose-audience-graph">
                Anyone who can reach you
              </label>
            </div>

            <p className="screen__aside">
              Decided by your graph, not by this post. There is no per-bulletin audience to
              choose.
            </p>
          </fieldset>

          <fieldset className="compose-group">
            <legend className="compose-group__label">Expires</legend>

            <div className="compose-chips">
              {EXPIRY_PRESETS.map((preset) => (
                <Fragment key={preset.id}>
                  <input
                    className="compose-chip__input"
                    data-testid={`compose-bulletin-expiry-${preset.id}`}
                    type="radio"
                    id={`compose-expiry-${preset.id}`}
                    name="expiry"
                    value={preset.id}
                    checked={expiry === preset.id}
                    onChange={() => setExpiry(preset.id)}
                  />
                  <label className="compose-chip" htmlFor={`compose-expiry-${preset.id}`}>
                    {preset.label}
                  </label>
                </Fragment>
              ))}
            </div>
          </fieldset>
        </div>

        {refusal === null ? null : (
          <p className="form__error" data-testid="compose-bulletin-error" role="alert">
            {refusal}
          </p>
        )}

        <button
          className="button button--primary"
          data-testid="compose-bulletin-submit-button"
          type="submit"
          disabled={!issues.postable || submitting}
        >
          Post it
        </button>
      </form>

      {toast === null ? null : (
        <p className="compose-toast" data-testid="compose-bulletin-toast" role="status">
          {toast}
        </p>
      )}
    </section>
  );
}

/**
 * A labelled field with a live character count and, when it is over, one line saying so.
 *
 * The count reports the **trimmed** length because that is the length the limit is
 * measured against, here and on the server. A counter that turned red over trailing
 * spaces the server would have thrown away would be contradicting the button beside it.
 */
function ComposeField(props: {
  readonly fieldId: string;
  readonly label: string;
  readonly value: string;
  readonly maxLength: number;
  readonly issue: DraftFieldIssue | null;
  readonly optional?: boolean;
  readonly children: ReactNode;
}): JSX.Element {
  const length = props.value.trim().length;
  const over = props.issue === 'too-long';

  return (
    <div className="form__field">
      <div className="compose-field__label-row">
        <label className="form__label" htmlFor={props.fieldId}>
          {props.label}
          {props.optional === true ? ' (optional)' : ''}
        </label>
        <span
          className="compose-field__count"
          id={`${props.fieldId}-count`}
          data-testid={`${props.fieldId}-count`}
          data-over={over ? 'true' : 'false'}
        >
          {length}/{props.maxLength}
        </span>
      </div>

      {props.children}

      {over ? (
        <p className="form__error" id={`${props.fieldId}-error`}>
          {props.maxLength} characters at most — {length - props.maxLength} over.
        </p>
      ) : null}
    </div>
  );
}

/**
 * The identity and description wiring a {@link ComposeField}'s control needs.
 *
 * One place owns the id convention, so a control can never end up described by an element
 * that is not rendered — which is a description a screen reader silently drops.
 */
function fieldAria(
  fieldId: string,
  over: boolean,
): { readonly id: string; readonly 'aria-describedby': string; readonly 'aria-invalid': boolean } {
  return {
    id: fieldId,
    'aria-describedby': over ? `${fieldId}-count ${fieldId}-error` : `${fieldId}-count`,
    'aria-invalid': over,
  };
}
