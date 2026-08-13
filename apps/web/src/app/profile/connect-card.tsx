import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type JSX } from 'react';
import QRCode from 'react-qr-code';

import { useApi } from '../api/api-provider';
import { PERSONAL_LINK_QUERY_KEY } from '../connections/connection-query-keys';
import {
  PERSONAL_LINK_CARD_LINE,
  PERSONAL_LINK_ROTATED_LINE,
  ROTATE_PERSONAL_LINK_LABEL,
  ROTATE_PERSONAL_LINK_LINE,
} from '../connections/connection-request-copy';

import {
  personalLinkShareBlurb,
  personalLinkShareText,
  personalLinkUrl,
} from './personal-link-share';
import { RetryRow } from './retry-row';

/** How long the copy button's "Copied" confirmation holds before reverting — the same
 *  shape as `ComposeBulletinForm`'s toast timer, held a little shorter since nothing
 *  here navigates the user away when it ends. Exported so the AC5 revert test waits on
 *  the real value rather than a second, driftable copy of the literal. */
export const COPIED_HOLD_MS = 1500;

/**
 * The You screen's standing CONNECT card (issues #90, #142 and #206): QR, link, what the
 * link does, a share button, and a rotate control.
 *
 * ⚠ **It shares a personal link, not an invite token** (issue #206). The two differ in the
 * one way that matters on this screen: an invite was spent by whoever opened it first, so a
 * link re-sent in a group chat connected one person and gave everybody else "this invite
 * cannot be opened" — the prod failure #206 was filed for. A personal link is an address.
 * It never dies from use, opening it connects nobody, and the owner answers each request
 * from the inbox on `/graph`.
 *
 * ⚠ **Nothing here mints an invite any more, and `connections.invitations.*` is still
 * served.** Tokens already sitting in somebody's chat history have to keep opening; what
 * changed is that no new one is created. Reintroducing a `create` call on this screen would
 * put the spendable model back in front of users while the permanent one sits beside it.
 *
 * Its own component rather than a block inside `YourProfileRoute` because the card is the
 * screen's one piece with three renderable states and no dependence on the session or the
 * offline store — extracted, its loading and error branches are mountable over
 * `mount-with-api`'s fake alone, where the route as a whole would drag Dexie and IndexedDB
 * into jsdom (PR #144 review).
 */
export function ConnectCard(): JSX.Element {
  const api = useApi();
  const queryClient = useQueryClient();

  /*
   * A write behind `useQuery`, deliberately — the same trade the invite card made, and safe
   * here for a stronger reason. The comp's card *stands ready*: there is no "create my link"
   * step to press, so the mint has to happen on arrival, and arrival is what a query models.
   * What makes it safe is the *server*: `personalLink.ensure` is get-or-create keyed on the
   * owner, so refetches, cache eviction, reloads, and the offline sync-drain's blanket
   * invalidation all land on the same slug. It is the database's `on conflict (owner_id)`
   * rather than a read-then-write, so two arrivals racing cannot mint two links.
   *
   * ⚠ **A second call must never rotate**, which is the one bug this arrangement could have
   * and it would be silent: the screen would show a working link while every copy already
   * shared stopped resolving. Rotation is the explicit control below, and nothing else.
   *
   * `staleTime: Infinity` is politeness — it spares the network — not the safety mechanism.
   */
  const link = useQuery({
    queryKey: PERSONAL_LINK_QUERY_KEY,
    queryFn: () => api.mutate('connections.personalLink.ensure', undefined),
    staleTime: Infinity,
  });

  const [rotated, setRotated] = useState(false);

  const rotate = useMutation({
    mutationFn: () => api.mutate('connections.personalLink.rotate', undefined),
    onSuccess: (fresh) => {
      /*
       * The new link is written straight into the cache rather than invalidated into a
       * refetch. The mutation already returned the authoritative row, and a refetch here
       * would leave a window in which the card shows the *old* slug — a URL that no longer
       * opens — which is the one thing a rotation must never display.
       */
      queryClient.setQueryData(PERSONAL_LINK_QUERY_KEY, fresh);
      setRotated(true);
    },
  });

  const shareUrl =
    link.data === undefined ? null : personalLinkUrl(window.location.origin, link.data.slug);

  if (link.isError) {
    return <RetryRow message="Your link did not load." onRetry={() => void link.refetch()} />;
  }

  if (shareUrl === null) {
    return <p className="profile__quiet">Getting your link…</p>;
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
      <div className="profile__qr" data-testid="personal-link-qr">
        <QRCode value={shareUrl} size={100} level="M" bgColor="#ffffff" fgColor="#000000" />
      </div>

      <div className="profile__connect-body">
        <div className="profile__invite-row">
          <span className="profile__invite-link" data-testid="personal-link">
            {shareUrl}
          </span>
          {/*
            Sharing or copying clears the rotated banner: those are the acts of moving on
            to the new link, and "the old one no longer opens" is stale advice once the new
            one is in somebody's hands. Without this the banner would sit for the rest of
            the mount.
          */}
          <CopyLinkButton url={shareUrl} onActivate={() => setRotated(false)} />
        </div>
        <p className="screen__aside">{PERSONAL_LINK_CARD_LINE}</p>
        <button
          className="profile__share"
          data-testid="personal-link-share-button"
          type="button"
          onClick={() => {
            setRotated(false);
            void sharePersonalLink(shareUrl);
          }}
        >
          Share link
        </button>

        {/*
          The rotate control, and the sentence that makes it pressable. Both halves of
          `ROTATE_PERSONAL_LINK_LINE` are load-bearing: people do not press a
          destructive-looking button without knowing its blast radius, and the product
          argument for a rotatable link is that rotating is cheap.

          ⚠ No confirmation dialog, deliberately. The moment somebody most wants to rotate
          is the moment they are being bothered through the link, and a dialog between them
          and that is a tax on the one action this feature exists to make easy. An
          accidental rotation costs a re-share; a slow one costs more.
        */}
        <p className="screen__aside profile__rotate-line">{ROTATE_PERSONAL_LINK_LINE}</p>
        <button
          className="button button--quiet"
          data-testid="rotate-personal-link-button"
          type="button"
          disabled={rotate.isPending}
          onClick={() => {
            rotate.mutate();
          }}
        >
          {ROTATE_PERSONAL_LINK_LABEL}
        </button>

        {rotate.isError ? (
          <p className="form__error" role="alert" data-testid="rotate-personal-link-error">
            That did not work. Your current link still opens.
          </p>
        ) : null}

        {rotated ? (
          <p className="banner banner--good" role="status" data-testid="personal-link-rotated">
            {PERSONAL_LINK_ROTATED_LINE}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Hand the link to the platform's share sheet, or to the clipboard.
 *
 * ⚠ **`text` and `url` never overlap.** `navigator.share`'s `text` field carries only the
 * blurb; the link travels solely in `url`. Passing both fields with the link folded into
 * `text` too used to mean a share target that reads both fields verbatim — the OS share
 * sheet's own Copy action among them — pasted the link twice (issue #160). The clipboard
 * fallback has no separate `url` field to lean on, so it gets the combined, self-contained
 * form instead.
 *
 * ⚠ Both branches can reject — `navigator.share` throws `AbortError` when the user dismisses
 * the sheet, and the clipboard throws when the document is not focused. Neither is a failure
 * worth interrupting anybody over, and neither leaves the app in a bad state, so both are
 * swallowed. The link is on screen either way, which is the fallback that always works.
 */
async function sharePersonalLink(url: string): Promise<void> {
  try {
    if (typeof navigator.share === 'function') {
      await navigator.share({ text: personalLinkShareBlurb(), url });
      return;
    }

    await navigator.clipboard.writeText(personalLinkShareText(url));
  } catch {
    // Deliberately silent; see above.
  }
}

/**
 * The one-tap copy affordance beside the link (issue #160 AC3/AC4): the app's icon-button
 * idiom — a round svg-glyph button whose accessible name carries state, the same shape
 * `ThemeToggle` uses for its own multi-state glyph — sized to sit inline beside a text row
 * instead of the header's chrome.
 *
 * Copies the **bare** URL, deliberately: this is the "grab the link" affordance, not the
 * share sheet's, so there is no blurb to carry.
 */
function CopyLinkButton({
  url,
  onActivate,
}: {
  readonly url: string;
  /** Fired on every press, success or not — the press itself is the "moving on" signal. */
  readonly onActivate?: () => void;
}): JSX.Element {
  const [copied, setCopied] = useState(false);

  // Mirrors `ComposeBulletinForm`'s toast timer: setting `copied` is what schedules its
  // own reversal, so there is one place the transient state's lifetime is decided.
  //
  // ⚠ The cleanup below only matters for unmount. React bails out of a `setCopied(true)`
  // call when `copied` is already `true` — same value, no re-render — so a second click
  // landing inside the hold window neither restarts this timer nor cancels it; the label
  // still reverts on the schedule the *first* click set, not a fresh `COPIED_HOLD_MS` from
  // the second.
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
      // Deliberately silent, matching `sharePersonalLink` above: the link is still on screen
      // to copy by hand, and nothing else here depends on this succeeding.
    }
  }

  return (
    <button
      className={copied ? 'icon-button profile__copy profile__copy--copied' : 'icon-button profile__copy'}
      data-testid="copy-personal-link-button"
      type="button"
      aria-label={copied ? 'Copied' : 'Copy your link'}
      onClick={() => {
        onActivate?.();
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
