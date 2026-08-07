import type { JSX } from 'react';

import { useSession } from '../auth/session-provider';

/**
 * `/you` — the You tab's destination, before the profile screen exists.
 *
 * Sign-out lives here rather than in the header. The comp's chrome carries a wordmark
 * and two icons and nothing else, and account controls belong on the account screen —
 * so relocating the button was the alternative to deleting a capability the app still
 * needs. The rest of this screen (profile, invite QR, the two privacy limits, the sync
 * queue) is issue #49's.
 */
export function YourProfileRoute(): JSX.Element {
  const { signOut } = useSession();

  return (
    <section className="screen" data-testid="your-profile">
      <h1 className="screen__title">You</h1>
      <p className="screen__lede">
        Your profile, your invite, who may see your name, who may pin to your board, and
        what is still waiting to sync.
      </p>

      <p className="screen__empty">Not built yet. This screen lands soon.</p>

      <button
        className="button"
        data-testid="sign-out-button"
        type="button"
        onClick={() => {
          void signOut();
        }}
      >
        Sign out
      </button>
    </section>
  );
}
