import type { JSX } from 'react';

/**
 * A `role="alert"` refusal message plus a `TRY AGAIN` pill that refetches.
 *
 * The You screen's CONNECT card and its visibility dial each hit this identical shape
 * on their own query's error branch (connect-card.tsx, routes/your-profile.tsx) — one
 * markup kept in sync with `your-profile.css` instead of two copies drifting apart.
 */
export function RetryRow({
  message,
  onRetry,
}: {
  readonly message: string;
  readonly onRetry: () => void;
}): JSX.Element {
  return (
    <div className="profile__row">
      <p className="form__error" role="alert">
        {message}
      </p>
      <button
        className="profile__pill profile__pill--bad profile__dial"
        type="button"
        onClick={onRetry}
      >
        TRY AGAIN
      </button>
    </div>
  );
}
