import { useState, type FormEvent, type JSX } from 'react';
import { Navigate } from 'react-router';

import { useSession } from '../auth/session-provider';
import { describeSignInFailure } from '../auth/sign-in-failure';

/**
 * Sign-in: an email address and a magic link, which is the whole of ADR-0008's
 * identity story for M2 — no password to store, no second factor to build.
 *
 * There is **no** development or test sign-in path in this component. The e2e run
 * reaches an authenticated state by seeding a token minted against a mocked *issuer*
 * (`auth/session.ts`), so the screen the browser test skips is the same screen a user
 * gets, and no bypass is compiled into the production bundle to be found later.
 */
export function SignInRoute(): JSX.Element {
  const { status, requestSignInLink } = useSession();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  if (status === 'signed-in') {
    return <Navigate to="/" replace />;
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFailure(null);

    try {
      await requestSignInLink(email);
      setSent(true);
    } catch (error) {
      // Every branch lives in `auth/sign-in-failure.ts`, which is unit-tested; a
      // condition written inline here is one no test in this repository can reach.
      setFailure(describeSignInFailure(error));
    }
  }

  return (
    <div className="app-frame">
      <main className="app-column" data-testid="sign-in">
        <div className="screen screen--fill screen--centred">
          <h1 className="wordmark wordmark--hero">The Playa Post</h1>
          <p className="screen__lede">A private, opt-in community trust network.</p>

          {sent ? (
            <p className="screen__notice" data-testid="sign-in-link-sent">
              Check your email for a sign-in link.
            </p>
          ) : (
            <form
              className="form"
              onSubmit={(event) => {
                void onSubmit(event);
              }}
            >
              <label className="form__field">
                <span className="form__label">Email</span>
                <input
                  className="form__input"
                  type="email"
                  name="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </label>

              <button className="button button--primary" type="submit">
                Send me a sign-in link
              </button>
            </form>
          )}

          {failure === null ? null : (
            <p className="form__error" role="alert">
              {failure}
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
