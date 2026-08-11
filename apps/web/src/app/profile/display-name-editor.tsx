import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent, type JSX } from 'react';

import { DISPLAY_NAME_MAX_LENGTH } from '@playa-post/contracts';

import { useApi } from '../api/api-provider';

/** What the editor needs from the screen around it. */
export interface DisplayNameEditorProps {
  /**
   * The name as the server last told us it is, or `undefined` while that is still in
   * flight.
   *
   * A prop rather than a query of its own: the You screen already knows this from
   * `graph.list` (the viewer is on their own graph at degree 0 with `full`
   * disclosure), and a second answer to "what am I called" is a second thing that can
   * disagree.
   */
  readonly displayName: string | undefined;
}

/**
 * The name at the top of the You screen, and the way to change it (issue #177).
 *
 * **Inline, not a screen and not a sheet.** Renaming yourself is one short field with
 * no rules to explain — the handle rules are what earned onboarding a screen of its
 * own, and a handle cannot be changed at all (ADR-0008 rule 4, decision D15). So the
 * heading becomes a field in place, which keeps the edit next to the thing it edits.
 *
 * **No control at all until the name has loaded.** An edit box that opens empty
 * invites somebody to overwrite a name they cannot currently see, which is the one
 * mistake this control must not make easy. The same reasoning as the visibility
 * section's "Loading your visibility…", applied to a field rather than a dial.
 *
 * ⚠ **The whole query cache is invalidated on success, deliberately.** A display name
 * is rendered wherever a person appears — the profile heading and its initial, the
 * graph, board attribution, note author cards, intro rows — and every one of those is
 * a §6a projection the server recomputes on read, so there is no client-side copy to
 * patch. Enumerating the affected keys would be a list that rots the next time a
 * screen renders a name; `onboarding.tsx` invalidates everything for exactly this
 * reason, on exactly this field.
 */
export function DisplayNameEditor({ displayName }: DisplayNameEditorProps): JSX.Element {
  const api = useApi();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const editButtonRef = useRef<HTMLButtonElement>(null);

  /** Whether the previous render was the editing one — see the focus effect below. */
  const wasEditing = useRef(false);

  /** The name being typed, or `null` when the heading is just a heading. */
  const [draft, setDraft] = useState<string | null>(null);

  const rename = useMutation({
    mutationFn: (name: string) => api.mutate('identity.updateDisplayName', { displayName: name }),
    onSuccess: async () => {
      // Closed on the server's answer rather than on submit: the heading underneath
      // must never show a name the server has not accepted.
      setDraft(null);
      await queryClient.invalidateQueries();
    },
  });

  /*
   * Focus follows the field into existence, and back out again.
   *
   * Without the first half, pressing Edit leaves a keyboard or screen-reader user on a
   * button that has just disappeared, with the field they asked for somewhere they were
   * never told about. Without the second, saving or cancelling unmounts whatever they
   * were on and drops them to `<body>` — back at the top of the document, having lost
   * their place for the crime of finishing.
   *
   * ⚠ **Neither half can live in `onSuccess` or the Cancel handler.** Both run before
   * React has committed the render that puts the Edit button back, so the ref they would
   * call `.focus()` on is still empty. An effect runs after that commit, which is the
   * only moment the element exists to be focused. `wasEditing` is what keeps the
   * closing half from firing on first mount, when the editor is shut because it was
   * never open and focus belongs wherever the page put it.
   *
   * The dependencies are `editing` and `saving`, never `draft`: depending on the text
   * itself would re-focus on every keystroke and drop the caret to the end mid-word.
   * `saving` is here because the input disables itself for the duration of the request,
   * and disabling a focused element blurs it — so when a save is *refused*, this is what
   * hands the field back to the person who still has to fix it.
   */
  const editing = draft !== null;
  const saving = rename.isPending;

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
    } else if (wasEditing.current) {
      editButtonRef.current?.focus();
    }

    wasEditing.current = editing;
  }, [editing, saving]);

  if (draft === null) {
    return (
      <div className="profile__name-row">
        <h1 className="profile__name">{displayName ?? 'You'}</h1>

        {displayName === undefined ? null : (
          <button
            className="profile__name-edit"
            data-testid="display-name-edit-button"
            ref={editButtonRef}
            type="button"
            onClick={() => {
              rename.reset();
              setDraft(displayName);
            }}
          >
            Edit
          </button>
        )}
      </div>
    );
  }

  // Trimmed here as well as on the server, so Save is disabled for a name the server
  // would refuse rather than offering a round trip that cannot succeed.
  const trimmed = draft.trim();
  const submittable = trimmed.length > 0;

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    if (submittable) {
      rename.mutate(trimmed);
    }
  }

  return (
    <form className="profile__name-form" data-testid="display-name-form" onSubmit={onSubmit}>
      <label className="form__field">
        <span className="form__label">Display name</span>
        {/*
         * Frozen while the request is out, so text typed after Save is pressed is not
         * silently discarded by the `setDraft(null)` that closes the editor on success.
         */}
        <input
          className="form__input"
          data-testid="display-name-input"
          disabled={saving}
          name="displayName"
          ref={inputRef}
          required
          maxLength={DISPLAY_NAME_MAX_LENGTH}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
      </label>

      <div className="profile__name-actions">
        <button
          className="button button--primary"
          data-testid="display-name-save-button"
          type="submit"
          disabled={!submittable || saving}
        >
          Save
        </button>
        <button
          className="button button--quiet"
          data-testid="display-name-cancel-button"
          type="button"
          disabled={saving}
          onClick={() => {
            rename.reset();
            setDraft(null);
          }}
        >
          Cancel
        </button>
      </div>

      {rename.error === null ? null : (
        <p className="form__error" role="alert" data-testid="display-name-error">
          That name did not save. Try again.
        </p>
      )}
    </form>
  );
}
