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
   * Focus follows the field into existence. Without this, pressing Edit leaves a
   * keyboard or screen-reader user on a button that has just disappeared, with the
   * field they asked for somewhere they were never told about.
   *
   * The dependency is `editing`, not `draft`: depending on the text itself would
   * re-focus on every keystroke and drop the caret back to the end mid-word.
   */
  const editing = draft !== null;

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
    }
  }, [editing]);

  if (draft === null) {
    return (
      <div className="profile__name-row">
        <h1 className="profile__name">{displayName ?? 'You'}</h1>

        {displayName === undefined ? null : (
          <button
            className="profile__name-edit"
            data-testid="display-name-edit-button"
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
        <input
          className="form__input"
          data-testid="display-name-input"
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
          disabled={!submittable || rename.isPending}
        >
          Save
        </button>
        <button
          className="button button--quiet"
          data-testid="display-name-cancel-button"
          type="button"
          disabled={rename.isPending}
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
