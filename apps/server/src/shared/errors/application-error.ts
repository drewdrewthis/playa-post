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

  /**
   * What this error looks like when anything serializes it: **the code and the
   * message, and nothing else.**
   *
   * M2-AC18 requires every failure surface to answer with "a structured error with a
   * stable code and **no stack or internal detail**", and an `Error` serializes its
   * `stack` by default — `JSON.stringify(error, Object.getOwnPropertyNames(error))` is
   * the idiom that reaches it, and a stack names internal file paths, line numbers,
   * and the shape of the call graph. Declaring the wire form here rather than
   * stripping it at each transport means a second transport (the sync envelope, an
   * outbox consumer's dead-letter record) cannot forget.
   *
   * The `stack` property is untouched on the object itself, so a logger or a debugger
   * still has it. This is about what leaves the process.
   */
  toJSON(): { readonly code: string; readonly message: string } {
    return { code: this.code, message: this.message };
  }
}
