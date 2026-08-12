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
      // A rejected code is never worth retrying as typed — `isCodeRejected` in
      // `sign-in-failure.ts` collapses wrong/expired/already-used into one signal, so
      // the one honest move is clearing the field rather than leaving a digit that
      // looks correct sitting in a box that will refuse it again.
      setCode('');
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
              <p className="screen__lede">Or enter the code from the same email.</p>
              <form
                className="form"
                onSubmit={(event) => {
                  void onSubmitCode(event);
                }}
              >
                <label className="form__field">
                  <span className="form__label">Sign-in code</span>
                  {/* 6–8, not exactly 6: the code's length is the auth provider's
                      setting, not this form's — production issues 8 digits
                      (`mailer_otp_length: 8`) while the local stack defaults to 6, and
                      a `maxLength` shorter than the emailed code silently truncates it
                      so no correct entry can ever reach the server (#199). */}
                  <input
                    className="form__input"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]{6,8}"
                    maxLength={8}
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

              {/* The rejection copy in `sign-in-failure.ts` tells a rejected-code
                  reader to "Request a new sign-in email" — this is that offer. Ghost
                  styling (the bare `.button`, same as the dismiss action in
                  `bulletin-detail-sheet.tsx`) keeps it visibly secondary to "Sign in
                  with code" above, and it doubles as the only way back to the email
                  form once `sent` is `true`, rejection or not. */}
              <button
                className="button"
                type="button"
                data-testid="sign-in-request-new-code-button"
                onClick={() => {
                  setSent(false);
                  setCode('');
                  setFailure(null);
                }}
              >
                Send a new sign-in email
              </button>
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
