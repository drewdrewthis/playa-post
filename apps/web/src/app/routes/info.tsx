import type { JSX } from 'react';
import QRCode from 'react-qr-code';
import { Link } from 'react-router';

import {
  BUY_ME_A_COFFEE_LABEL,
  BUY_ME_A_COFFEE_URL,
  GITHUB_REPO_URL,
  INFO_PITCH,
  INFO_VALUES,
} from '../info/info-copy';

import '../info/info.css';

/**
 * `/info` — the Info screen (issue #216), in the bottom-nav slot Saved Views freed (#208).
 *
 * What Playa Post is, why it exists, why it is different — plus the receipts: the
 * open-source repository and a way to support the project. The prose is the welcome
 * carousel's own, imported from `info-copy.ts` rather than retyped, so the pitch a
 * visitor swiped through and the one a member rereads here cannot drift apart.
 *
 * Everything on this screen is static and network-free: no queries, no offline queue.
 * The two anchors leave the app deliberately (`target="_blank"`), because navigating
 * the PWA itself to GitHub would trade the whole app for a page with no way back but
 * the browser.
 */
export function InfoRoute(): JSX.Element {
  return (
    <section className="screen" data-testid="info-screen">
      <h1 className="info__title">Playa Post</h1>

      <p className="screen__lede">{INFO_PITCH}</p>

      <p className="screen__lede">{INFO_VALUES}</p>

      <div className="info__section">
        <h2 className="info__section-label">Open source</h2>
        {/* One sentence, deliberately (issue #224): "the whole app lives in a public
            repository" invited the misreading that *members' data* is public. The link
            below is the receipt; it does not need announcing. */}
        <p className="screen__aside">Always open-source is a promise you can check.</p>
        <a
          className="button info__link"
          data-testid="info-github-link"
          href={GITHUB_REPO_URL}
          target="_blank"
          rel="noreferrer"
        >
          View the code on GitHub
        </a>
      </div>

      <div className="info__section">
        <h2 className="info__section-label">Support</h2>
        {/* The CONNECT card's shape (issue #224): QR on the left, words and the action in a
            body on the right, one bordered box — loose stacked parts read as unfinished next
            to the You screen's card. The wash is Buy Me a Coffee's brand purple, not the app
            palette, for the same reason the button wears it: this box leaves the app. */}
        <div className="info__support-card" data-testid="info-support-card">
          {/*
            Same hard-coded white/black as the CONNECT card's QR, for the same reason: a
            scanner needs dark modules on a light field in both themes, and this code gets
            read off somebody else's screen at arm's length.
          */}
          <div className="info__qr" data-testid="info-coffee-qr">
            <QRCode value={BUY_ME_A_COFFEE_URL} size={100} level="M" bgColor="#ffffff" fgColor="#000000" />
          </div>
          <div className="info__support-body">
            <p className="screen__aside">
              Playa Post is free and carries no ads. If it has been good to you, a coffee
              keeps the lights on.
            </p>
            <a
              className="button info__coffee"
              data-testid="info-coffee-link"
              href={BUY_ME_A_COFFEE_URL}
              target="_blank"
              rel="noreferrer"
            >
              {BUY_ME_A_COFFEE_LABEL}
            </a>
          </div>
        </div>
      </div>

      {/* The same replay affordance the You screen carries — this screen is the pitch's
          permanent home, so the full tour belongs one tap away. */}
      <Link className="info__replay" data-testid="info-replay-welcome" to="/welcome">
        Replay the welcome tour →
      </Link>
    </section>
  );
}
