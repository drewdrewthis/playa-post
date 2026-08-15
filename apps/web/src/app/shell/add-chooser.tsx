import { useEffect, useId, useRef, type JSX } from 'react';
import { useNavigate } from 'react-router';

import './add-chooser.css';

/**
 * The plus button's chooser (issue #221): "add" means two different things in this
 * product — a person into your network, or a post onto the board — and the FAB now
 * asks which before assuming.
 *
 * Two options, each with a one-line explainer above its button, per the owner's spec.
 * The network option lands on the You screen, where the CONNECT card (the personal
 * link, its QR, and the share button) already is — the chooser routes to the existing
 * affordance rather than growing a second copy of it.
 *
 * ⚠ The board option carries `compose-bulletin-button`, the test id the FAB itself
 * used to hold: that id names *the compose affordance*, and this button is what now
 * opens the compose form. The FAB is `add-button`.
 *
 * Exits match the sheets: the CLOSE control, Escape, the scrim — and choosing.
 */
export function AddChooser({ onClose }: { readonly onClose: () => void }): JSX.Element {
  const titleId = useId();
  const sheetRef = useRef<HTMLElement>(null);
  const navigate = useNavigate();

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

  // Focus moves in on open, so Escape lands on this sheet's handler.
  useEffect(() => {
    sheetRef.current?.focus();
  }, []);

  function choose(destination: string): void {
    onClose();
    void navigate(destination);
  }

  return (
    <>
      <div
        className="add-chooser__scrim"
        aria-hidden="true"
        onClick={() => {
          onClose();
        }}
      />

      <section
        className="add-chooser"
        data-testid="add-chooser"
        ref={sheetRef}
        /* `role="dialog"` without `aria-modal`, for the reason the sheets record:
           nothing behind this is `inert`, and claiming modality would describe a trap
           that does not exist. */
        role="dialog"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="add-chooser__header">
          <h2 className="add-chooser__title" id={titleId}>
            What are you adding?
          </h2>

          <button
            className="add-chooser__close"
            data-testid="add-chooser-close-button"
            type="button"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        <div className="add-chooser__option">
          <p className="add-chooser__explainer">
            Grow your circle — share your personal link with someone you trust.
          </p>
          <button
            className="button button--primary"
            data-testid="add-network-button"
            type="button"
            onClick={() => {
              choose('/you');
            }}
          >
            Add someone to your network
          </button>
        </div>

        <div className="add-chooser__option">
          <p className="add-chooser__explainer">
            Offer something, ask for something, or announce a gathering.
          </p>
          <button
            className="button button--primary"
            data-testid="compose-bulletin-button"
            type="button"
            onClick={() => {
              choose('/board/new');
            }}
          >
            Add something to the board
          </button>
        </div>
      </section>
    </>
  );
}
