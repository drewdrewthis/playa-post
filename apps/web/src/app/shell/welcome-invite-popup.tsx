import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type JSX } from 'react';

import { useApi } from '../api/api-provider';
import { PERSONAL_LINK_QUERY_KEY } from '../connections/connection-query-keys';
import { personalLinkUrl, sharePersonalLink } from '../profile/personal-link-share';
import {
  dismissInviteHintForever,
  hasDismissedInviteHint,
  INVITE_HINT_DELAY_MS,
} from '../welcome/invite-hint';

import './welcome-invite-popup.css';

/**
 * The one-time welcome popup (issue #220): a beat after the shell mounts, the app
 * introduces the single most important growth action — your personal invite link —
 * with a share button, right where a new user actually is instead of behind the You
 * screen.
 *
 * Self-gating: the shell mounts it unconditionally and this component decides, so the
 * shell stays a frame with no invite-hint policy in it. It renders nothing when the
 * device has said "don't show me again" (`invite-hint.ts`), and nothing until the
 * delay has passed — the delay is what makes it a welcome over the app rather than an
 * interstitial in front of it.
 *
 * ⚠ The link query runs only once the popup is open. `personalLink.ensure` is a
 * get-or-create keyed on the owner (safe to call any number of times — see
 * `connect-card.tsx`), but a dismissed popup calling it on every app open would be a
 * network round trip spent on nothing. It shares `PERSONAL_LINK_QUERY_KEY` with the
 * connect card, so whichever of the two runs first warms the other.
 *
 * Dismissal is two different acts: Dismiss (and Escape, and the scrim) closes this
 * visit only; the "don't show this again" checkbox is what makes it permanent, and it
 * is honoured by whichever way the popup then closes.
 */
export function WelcomeInvitePopup({
  delayMs = INVITE_HINT_DELAY_MS,
}: {
  /** Tests pass 0; the shell takes the default. */
  readonly delayMs?: number;
}): JSX.Element | null {
  const [open, setOpen] = useState(false);
  const [dontShowAgain, setDontShowAgain] = useState(false);

  // Read once, on mount: the popup either belongs to this visit or it does not, and
  // re-reading storage on re-render would let a mid-visit write flick it off-screen.
  const [permanentlyDismissed] = useState(hasDismissedInviteHint);

  useEffect(() => {
    if (permanentlyDismissed) {
      return;
    }

    const timer = setTimeout(() => {
      setOpen(true);
    }, delayMs);

    return () => {
      clearTimeout(timer);
    };
  }, [permanentlyDismissed, delayMs]);

  function dismiss(): void {
    if (dontShowAgain) {
      dismissInviteHintForever();
    }

    setOpen(false);
  }

  if (!open) {
    return null;
  }

  return <InviteHintDialog dontShowAgain={dontShowAgain} onToggleDontShowAgain={setDontShowAgain} onDismiss={dismiss} />;
}

/**
 * The dialog itself, mounted only while open — which is what scopes the link query to
 * the popup actually showing (see the ⚠ above).
 *
 * Escape, the scrim, and the Dismiss button all leave through the same `onDismiss`,
 * matching `report-abuse-sheet.tsx`'s exits; focus moves in on open for the same
 * reason it does there — so Escape lands on this dialog's handler.
 */
function InviteHintDialog({
  dontShowAgain,
  onToggleDontShowAgain,
  onDismiss,
}: {
  readonly dontShowAgain: boolean;
  readonly onToggleDontShowAgain: (next: boolean) => void;
  readonly onDismiss: () => void;
}): JSX.Element {
  const api = useApi();
  const titleId = useId();
  const dialogRef = useRef<HTMLElement>(null);

  // The same write-behind-useQuery trade `connect-card.tsx` documents at length:
  // `ensure` is get-or-create on the server, so arrival is safe to model as a query.
  const link = useQuery({
    queryKey: PERSONAL_LINK_QUERY_KEY,
    queryFn: () => api.mutate('connections.personalLink.ensure', undefined),
    staleTime: Infinity,
  });

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        onDismiss();
      }
    }

    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onDismiss]);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  const shareUrl =
    link.data === undefined ? null : personalLinkUrl(window.location.origin, link.data.slug);

  return (
    <>
      <div
        className="invite-hint__scrim"
        aria-hidden="true"
        onClick={() => {
          onDismiss();
        }}
      />

      <section
        className="invite-hint"
        data-testid="welcome-invite-popup"
        ref={dialogRef}
        /* `role="dialog"` without `aria-modal`, for the reason the sheets record:
           nothing behind this is `inert`, and claiming modality would describe a trap
           that does not exist. */
        role="dialog"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <p className="invite-hint__icon" aria-hidden="true">
          ✿
        </p>

        <h2 className="invite-hint__title" id={titleId}>
          Welcome to the party!
        </h2>

        <p className="invite-hint__body">
          Here&rsquo;s your personal invite link to send so that you can invite your friends.
        </p>

        {link.isError ? (
          <p className="invite-hint__quiet">
            Your link did not load — you can always find it on the You screen.
          </p>
        ) : shareUrl === null ? (
          <p className="invite-hint__quiet">Getting your link…</p>
        ) : (
          <>
            <p className="invite-hint__link" data-testid="invite-hint-link">
              {shareUrl}
            </p>
            <button
              className="button button--primary invite-hint__share"
              data-testid="invite-hint-share-button"
              type="button"
              onClick={() => {
                void sharePersonalLink(shareUrl);
              }}
            >
              Share link
            </button>
          </>
        )}

        <label className="invite-hint__remember">
          <input
            type="checkbox"
            data-testid="invite-hint-dont-show-again"
            checked={dontShowAgain}
            onChange={(event) => {
              onToggleDontShowAgain(event.target.checked);
            }}
          />
          <span>Don&rsquo;t show this again</span>
        </label>

        <button
          className="button button--quiet invite-hint__dismiss"
          data-testid="invite-hint-dismiss-button"
          type="button"
          onClick={onDismiss}
        >
          Dismiss
        </button>
      </section>
    </>
  );
}
