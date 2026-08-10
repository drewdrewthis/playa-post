import { useQuery } from '@tanstack/react-query';
import { useEffect, useState, type JSX } from 'react';
import QRCode from 'react-qr-code';

import { useApi } from '../api/api-provider';

import { inviteShareBlurb, inviteShareText, inviteUrl } from './invite-share';
import { RetryRow } from './retry-row';

/** How long the copy button's "Copied" confirmation holds before reverting — the same
 *  shape as `ComposeBulletinForm`'s toast timer, held a little shorter since nothing
 *  here navigates the user away when it ends. */
const COPIED_HOLD_MS = 1500;

/**
 * The one spelling of the invite-card query key, the discipline
 * `graph-query-keys.ts` documents. Today this card is the only reader; the day an
 * accept path wants to invalidate it, that writer imports this name instead of
 * re-spelling the literal and failing silently, forever.
 */
export const INVITE_QUERY_KEY = ['invite', 'mine'] as const;

/**
 * The You screen's standing CONNECT card (issues #90 and #142): QR, link, consent line
 * and share button, on screen the moment the card is, with nothing to press first.
 *
 * Its own component rather than a block inside `YourProfileRoute` because the card is
 * the screen's one piece with three renderable states and no dependence on the session
 * or the offline store — extracted, its loading and error branches are mountable over
 * `mount-with-api`'s fake alone, where the route as a whole would drag Dexie and
 * IndexedDB into jsdom (PR #144 review).
 */
export function ConnectCard(): JSX.Element {
  const api = useApi();

  /*
   * A write behind `useQuery`, deliberately. The comp's card *stands ready* — there is no
   * "create invite" step to press — so the mint has to happen on arrival, and arrival is
   * what a query models. What makes it safe is the *server*: `invitations.create` is
   * get-or-create, returning the outstanding pending invite and minting only when there
   * is none, so refetches, cache eviction, reloads, and the offline sync-drain's blanket
   * invalidation all land on the same token instead of minting fresh ones. `staleTime:
   * Infinity` is just politeness — it spares the network, it is not the safety mechanism.
   * A useful side effect of eviction re-asking: once this invite is spent, the next
   * arrival shows a live token where a purely client-owned answer showed the dead one
   * forever.
   */
  const invite = useQuery({
    queryKey: INVITE_QUERY_KEY,
    queryFn: () => api.mutate('connections.invitations.create', undefined),
    staleTime: Infinity,
  });

  const shareUrl =
    invite.data === undefined ? null : inviteUrl(window.location.origin, invite.data.token);

  if (invite.isError) {
    return (
      <RetryRow message="That invite did not get created." onRetry={() => void invite.refetch()} />
    );
  }

  if (shareUrl === null) {
    return <p className="profile__quiet">Minting your invite…</p>;
  }

  return (
    <div className="profile__connect">
      {/*
        White and black, hard-coded rather than tokenised, and the same in both
        themes: a scanner looks for dark modules on a light field, so letting the
        dark palette paint this would invert the contrast a camera needs and hand
        somebody a QR that photographs fine and does not read.

        `level="M"` for the same reason contrast is pinned: this code gets scanned
        off a dusty, glared, fingerprinted screen at arm's length, and the library's
        default `L` recovers only 7% damage. `M` recovers 15% for one version bump
        (33×33 → 37×37 modules) — redundancy is cheap, a failed scan at the trash
        fence is not.
      */}
      <div className="profile__qr" data-testid="invite-qr">
        <QRCode value={shareUrl} size={100} level="M" bgColor="#ffffff" fgColor="#000000" />
      </div>

      <div className="profile__connect-body">
        <div className="profile__invite-row">
          <span className="profile__invite-link" data-testid="invite-link">
            {shareUrl}
          </span>
          <CopyLinkButton url={shareUrl} />
        </div>
        <p className="screen__aside">
          Scan or tap to connect. Nothing happens until you both consent.
        </p>
        <button
          className="profile__share"
          data-testid="invite-share-button"
          type="button"
          onClick={() => {
            void shareInvite(shareUrl);
          }}
        >
          Share invite
        </button>
      </div>
    </div>
  );
}

/**
 * Hand the invite to the platform's share sheet, or to the clipboard.
 *
 * ⚠ **`text` and `url` never overlap.** `navigator.share`'s `text` field carries only the
 * consent blurb; the link travels solely in `url`. Passing both fields with the link
 * folded into `text` too used to mean a share target that reads both fields verbatim —
 * the OS share sheet's own Copy action among them — pasted the link twice (issue #160).
 * The clipboard fallback has no separate `url` field to lean on, so it gets the combined,
 * self-contained form instead.
 *
 * ⚠ Both branches can reject — `navigator.share` throws `AbortError` when the user
 * dismisses the sheet, and the clipboard throws when the document is not focused. Neither
 * is a failure worth interrupting anybody over, and neither leaves the app in a bad state,
 * so both are swallowed. The link is on screen either way, which is the fallback that
 * always works.
 */
async function shareInvite(url: string): Promise<void> {
  try {
    if (typeof navigator.share === 'function') {
      await navigator.share({ text: inviteShareBlurb(), url });
      return;
    }

    await navigator.clipboard.writeText(inviteShareText(url));
  } catch {
    // Deliberately silent; see above.
  }
}

/**
 * The one-tap copy affordance beside the invite link (issue #160 AC3/AC4): the app's
 * icon-button idiom — a round svg-glyph button whose accessible name carries state, the
 * same shape `ThemeToggle` uses for its own multi-state glyph — sized to sit inline
 * beside a text row instead of the header's chrome.
 *
 * Copies the **bare** URL, deliberately: this is the "grab the link" affordance, not the
 * share sheet's, so there is no consent blurb to carry.
 */
function CopyLinkButton({ url }: { readonly url: string }): JSX.Element {
  const [copied, setCopied] = useState(false);

  // Mirrors `ComposeBulletinForm`'s toast timer: setting `copied` is what schedules its
  // own reversal, so there is one place the transient state's lifetime is decided, and
  // clearing the timer on unmount (or on a second copy landing before the first expires)
  // keeps two clicks from racing each other's reversion.
  useEffect(() => {
    if (!copied) {
      return;
    }

    const timer = setTimeout(() => {
      setCopied(false);
    }, COPIED_HOLD_MS);

    return () => {
      clearTimeout(timer);
    };
  }, [copied]);

  async function onCopy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // Deliberately silent, matching `shareInvite` above: the link is still on screen
      // to copy by hand, and nothing else here depends on this succeeding.
    }
  }

  return (
    <button
      className={copied ? 'icon-button profile__copy profile__copy--copied' : 'icon-button profile__copy'}
      data-testid="copy-invite-link-button"
      type="button"
      aria-label={copied ? 'Copied' : 'Copy invite link'}
      onClick={() => {
        void onCopy();
      }}
    >
      {copied ? (
        <svg
          aria-hidden="true"
          width="1.125em"
          height="1.125em"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg
          aria-hidden="true"
          width="1.125em"
          height="1.125em"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </button>
  );
}
