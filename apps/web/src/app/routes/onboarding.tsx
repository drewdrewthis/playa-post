import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent, type JSX } from 'react';
import { useNavigate } from 'react-router';

import { DISPLAY_NAME_MAX_LENGTH } from '@playa-post/contracts';

import { useApi } from '../api/api-provider';
import { applicationErrorCode } from '../api/client';

/**
 * What each structured handle rejection means, in words a person can act on.
 *
 * ⚠ **The codes are the server's; the copy is this app's.** Rendering one generic
 * "something went wrong" for all five would leave a user guessing which rule they
 * broke — M2-AC25 asks for five distinguishable messages precisely because a handle
 * rule the user cannot see is a handle rule they cannot satisfy.
 *
 * An unrecognised code falls through to {@link UNKNOWN_HANDLE_FAILURE} rather than
 * being swallowed: a new server-side rule should read as unfamiliar, not as silence.
 */
const HANDLE_FAILURE_COPY: Readonly<Record<string, string>> = {
  HANDLE_RESERVED: 'That handle is reserved. Please choose another.',
  HANDLE_TAKEN: 'That handle is already taken.',
  HANDLE_CONFUSABLE: 'That handle looks too much like an existing one. Please choose another.',
  HANDLE_CHARSET: 'Handles use lowercase letters, numbers, and underscores only.',
  HANDLE_LENGTH: 'That handle is the wrong length.',
};

const UNKNOWN_HANDLE_FAILURE = 'That handle was not accepted.';

/**
 * Onboarding: the one screen between a verified email and a `app.users` row.
 *
 * Reached only by a signed-in principal the server has told us is not onboarded
 * (`RequireSession` reads the `FORBIDDEN` for that), so it never renders graph or
 * board content on the way past.
 */
export function OnboardingRoute(): JSX.Element {
  const api = useApi();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [handle, setHandle] = useState('');
  const [displayName, setDisplayName] = useState('');

  const onboarding = useMutation({
    mutationFn: (input: { handle: string; displayName: string }) =>
      api.mutate('identity.completeOnboarding', input),
    onSuccess: async () => {
      await queryClient.invalidateQueries();
      await navigate('/', { replace: true });
    },
  });

  const failureCode = applicationErrorCode(onboarding.error);
  const failure =
    onboarding.error === null
      ? null
      : (failureCode === null ? undefined : HANDLE_FAILURE_COPY[failureCode]) ??
        UNKNOWN_HANDLE_FAILURE;

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    onboarding.mutate({ handle, displayName });
  }

  return (
    <div className="app-frame">
      <main className="app-column" data-testid="onboarding">
        <div className="screen screen--fill screen--centred">
          <h1 className="screen__title screen__title--hero">Pick your handle</h1>
          <p className="screen__lede">
            Your handle is how people find you. Your display name is what they see.
          </p>

          <form className="form" onSubmit={onSubmit}>
            <label className="form__field">
              <span className="form__label">Handle</span>
              <input
                className="form__input"
                data-testid="onboarding-handle-input"
                name="handle"
                required
                value={handle}
                onChange={(event) => setHandle(event.target.value)}
              />
            </label>

            <label className="form__field">
              <span className="form__label">Display name</span>
              <input
                className="form__input"
                data-testid="onboarding-display-name-input"
                name="displayName"
                required
                maxLength={DISPLAY_NAME_MAX_LENGTH}
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
              />
            </label>

            <button
              className="button button--primary"
              data-testid="onboarding-submit-button"
              type="submit"
              disabled={onboarding.isPending}
            >
              Continue
            </button>
          </form>

          {failure === null ? null : (
            <p
              className="form__error"
              role="alert"
              data-testid="onboarding-handle-error"
              data-code={failureCode ?? 'UNKNOWN'}
            >
              {failure}
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
