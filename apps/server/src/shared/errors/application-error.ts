/**
 * An error a client is meant to act on, carrying a stable machine-readable code.
 *
 * M2-AC18 requires every failure surface to return "a structured error with a stable
 * code and no stack or internal detail", and the codes are contract: `HANDLE_IMMUTABLE`,
 * `INVITATION_UNAVAILABLE`, `BULLETIN_GONE`, `IDEMPOTENCY_KEY_REUSE`,
 * `ONBOARDING_REQUIRED`. A client branches on `code`; `message` is for a human reading
 * a log and may be reworded at any time.
 *
 * The transport maps this onto whatever it speaks — `shared/trpc/trpc.ts`'s error
 * formatter lifts `code` into `data.applicationCode` — so an application service never
 * knows it is being called over HTTP (addendum §6).
 *
 * **`message` must never carry state the caller is not authorized to learn.** "This
 * bulletin belongs to someone else" is a disclosure; `BULLETIN_GONE` is not
 * (ADR-0002 §10).
 */
export class ApplicationError extends Error {
  /** Stable, machine-readable, `SCREAMING_SNAKE_CASE`. Part of the API contract. */
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ApplicationError';
    this.code = code;
  }
}
