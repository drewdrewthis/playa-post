import { z } from 'zod';

/**
 * The longest display name this API accepts.
 *
 * A transport concern, not a domain rule: nothing in ADR-0008 constrains a display
 * name beyond `not null` (the column is bare `text`), and a person's name is theirs.
 * This bound exists so the column cannot be used as free storage, and it lives in
 * `transport/` because "how big may a request field be" is a question about the wire,
 * not about identity.
 *
 * `packages/contracts` restates the number for clients that want to stop a person
 * overrunning it before the round trip. Modules never import the contracts package, so
 * that copy is deliberate and one-directional — this declaration is the server's.
 */
export const DISPLAY_NAME_MAX_LENGTH = 80;

/**
 * The one schema every `displayName` field on this API is validated by.
 *
 * ⚠ **Shared rather than restated, because the edit must accept exactly what
 * onboarding accepts.** Two copies of `.trim().min(1).max(…)` would be two rules the
 * day somebody changes one of them, and the failure is silent in the worst direction:
 * a name a person could choose at sign-up but not restore afterwards, or the reverse.
 * `identity.completeOnboarding` and `identity.updateDisplayName` both take this
 * schema, so there is exactly one answer to "what is a display name" (decision D15).
 *
 * **Trimming is part of the rule, not a courtesy.** `z.string().trim()` transforms
 * before it validates, so `'   '` fails `.min(1)` and `'  Dusty  '` is stored as
 * `'Dusty'` — a name whose only content is whitespace is not a name, and leading
 * space would sort and render as if it were meaningful.
 */
export const displayNameSchema = z.string().trim().min(1).max(DISPLAY_NAME_MAX_LENGTH);
