import type { JSX } from 'react';

import './session-wait.css';

/**
 * The full-screen wait: the mandala mark turning slowly over a one-line status.
 *
 * This is what a cold or bad start shows first, and on the free hosting tier that
 * wait is real — the server spins down between visits and takes seconds to wake
 * (#200). A bare "Loading…" reads as a crash; a moving mark plus a sentence that
 * owns the wait reads as an app doing something.
 *
 * The mark is the precached PWA icon (`pwa-192x192.png`, in the service worker's
 * precache manifest), so it renders even when the network is the thing being
 * waited on.
 */
export function SessionWait({
  headline,
  detail,
}: {
  readonly headline: string;
  readonly detail?: string | undefined;
}): JSX.Element {
  return (
    <div className="app-frame">
      <main className="app-column">
        <div className="screen screen--fill screen--centred session-wait__screen">
          <img
            className="session-wait__mark"
            src="/pwa-192x192.png"
            alt=""
            aria-hidden="true"
            width={192}
            height={192}
            data-testid="session-wait-mark"
          />
          <p className="screen__notice" role="status">
            {headline}
          </p>
          {detail === undefined ? null : (
            <p className="screen__lede" data-testid="session-wait-detail">
              {detail}
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
