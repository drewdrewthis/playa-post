import { useState, type FormEvent, type JSX } from 'react';
import { Navigate } from 'react-router';

import { useSession } from '../auth/session-provider';
import { describeSignInFailure } from '../auth/sign-in-failure';

/**
 * Sign-in: an email address, then either a magic link or the one-time code the same
 * email carries — still no password to store, no second factor to build, ADR-0008's
 * identity story for M2. The code exists because a magic link opens the system browser,
 * which never hands a session back to an installed PWA (issue #179); it is the same
 * credential over a channel the PWA can complete itself, not a second thing to prove.
 *
 * There is **no** development or test sign-in path in this component. The e2e run
 * reaches an authenticated state by seeding a token minted against a mocked *issuer*
 * (`auth/session.ts`), so the screen the browser test skips is the same screen a user
 * gets, and no bypass is compiled into the production bundle to be found later.
 */
export function SignInRoute(): JSX.Element {
  const { status, requestSignInLink, verifySignInCode } = useSession();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState('');
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

  async function onSubmitCode(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFailure(null);

    try {
      await verifySignInCode(email, code);
      // No further action on success: it reaches this screen through the same
      // `onSessionChange` subscription a magic-link click does, which flips `status`
      // to `'signed-in'` — the redirect above then takes over on the next render.
    } catch (error) {
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
            <>
              <p className="screen__notice" data-testid="sign-in-link-sent">
                Check your email for a sign-in link.
              </p>
              <p className="screen__lede">Or enter the 6-digit code from the same email.</p>
              <form
                className="form"
                onSubmit={(event) => {
                  void onSubmitCode(event);
                }}
              >
                <label className="form__field">
                  <span className="form__label">6-digit code</span>
                  <input
                    className="form__input"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    required
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                    data-testid="sign-in-code-input"
                  />
                </label>

                <button
                  className="button button--primary"
                  type="submit"
                  data-testid="sign-in-code-submit-button"
                >
                  Sign in with code
                </button>
              </form>
            </>
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
