import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type JSX } from 'react';

import type { Person } from '@playa-post/contracts';

import { useApi } from '../api/api-provider';

import { PersonIdentity, trustLabel } from './person-identity';

import './person-sheet.css';

const TRUST_MIN = 0;
const TRUST_MAX = 100;

/**
 * One person, and the viewer's private directional trust in them — as the comp's
 * bottom sheet over the graph (`design/Playa Post.dc.html`, the `hasSel` block), not a
 * destination. Tapping a node is *selection*: the graph stays mounted behind the scrim,
 * and every way out of the sheet — CLOSE, Escape, the scrim — puts the viewer exactly
 * where they already were.
 *
 * ⚠ **Trust is the viewer's own value and belongs to nobody else.** The server returns
 * `null` for a connection the viewer does not hold (B6), so this sheet never has
 * another party's number to render even by accident. The slider is shown only when
 * there is a connection to hold an opinion about.
 *
 * `null` and `0` are two states. The slider's position for an unset value is the
 * minimum, but the label says *Not set* until the viewer saves — otherwise a user who
 * never expressed an opinion would be shown, and would eventually save, a zero they
 * never chose.
 */
export function PersonSheet({
  person,
  onClose,
}: {
  readonly person: Person;
  readonly onClose: () => void;
}): JSX.Element {
  const api = useApi();
  const queryClient = useQueryClient();
  const titleId = useId();
  const sheetRef = useRef<HTMLElement>(null);
  const otherUserId = person.userId;

  const connection = useQuery({
    queryKey: ['connection', otherUserId],
    queryFn: () => api.query('connections.connection.get', { otherUserId }),
  });

  const [draftTrust, setDraftTrust] = useState<number | null>(null);
  const savedTrust = connection.data?.trust ?? null;

  useEffect(() => {
    setDraftTrust(savedTrust);
  }, [savedTrust]);

  const saveTrust = useMutation({
    mutationFn: (trust: number) =>
      api.mutate('connections.trust.set', { subjectUserId: otherUserId, trust }),
    onSuccess: async () => {
      await queryClient.invalidateQueries();
    },
  });

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        onClose();
      }
    }

    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  // Focus moves into the sheet on open, so a keyboard user's next Tab is inside it and
  // Escape reaches this handler rather than the node they came from. On close, focus
  // returns to that node — an SVG circle, hence the SVGElement arm — so closing the
  // sheet does not dump a keyboard user at the top of the document.
  useEffect(() => {
    const opener = document.activeElement;
    sheetRef.current?.focus();

    return () => {
      if (opener instanceof HTMLElement || opener instanceof SVGElement) {
        opener.focus();
      }
    };
  }, []);

  return (
    <>
      {/*
       * Decorative: everything it does, the CLOSE control also does, and Escape does
       * again. It is hidden from assistive technology rather than announced as a second
       * unlabelled way to leave.
       */}
      <div
        className="person-sheet__scrim"
        aria-hidden="true"
        onClick={() => {
          onClose();
        }}
      />

      <section
        className="person-sheet"
        data-testid="person-sheet"
        ref={sheetRef}
        /*
         * `role="dialog"` without `aria-modal`, for `bulletin-detail-sheet.tsx`'s
         * reason: nothing behind the scrim is actually `inert`, and claiming modality
         * would describe a trap this does not build.
         */
        role="dialog"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="person-sheet__header">
          <h2 className="person-sheet__title" id={titleId}>
            <PersonIdentity identity={person} />
          </h2>

          <button
            className="person-sheet__close"
            data-testid="person-sheet-close-button"
            type="button"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        {/*
         * Four states, told apart on purpose: a query still in flight or failed must
         * not read as "not connected" — that message is the server's resolved `null`
         * (B6) and nothing else.
         */}
        {connection.isPending ? null : connection.isError ? (
          <p className="person-sheet__notice" role="alert">
            That did not load. Close the sheet and try again.
          </p>
        ) : connection.data === null ? (
          <p className="person-sheet__notice">
            {/* The comp's "connect first to set trust": a tappable node past the first
                degree is somebody the viewer can see, not somebody they hold trust in. */}
            You are not connected to this person, so there is nothing to set.
          </p>
        ) : (
          <>
            <p className="person-sheet__lede">
              Trust is private and one-directional. They never see it, and neither does
              anyone else.
            </p>

            <p className="person-sheet__trust-value" data-testid="person-sheet-trust-value">
              Your trust: {trustLabel(draftTrust)}
            </p>

            <label className="form__field">
              <span className="form__label">Trust</span>
              <input
                className="form__slider"
                type="range"
                aria-label="Trust"
                min={TRUST_MIN}
                max={TRUST_MAX}
                value={draftTrust ?? TRUST_MIN}
                onChange={(event) => setDraftTrust(Number(event.target.value))}
              />
            </label>

            <button
              className="button button--primary"
              data-testid="person-sheet-save-trust-button"
              type="button"
              disabled={draftTrust === null || saveTrust.isPending}
              onClick={() => {
                if (draftTrust !== null) {
                  saveTrust.mutate(draftTrust);
                }
              }}
            >
              Save trust
            </button>
          </>
        )}

        {saveTrust.error === null ? null : (
          <p className="form__error" role="alert">
            That did not save. Try again.
          </p>
        )}
      </section>
    </>
  );
}
