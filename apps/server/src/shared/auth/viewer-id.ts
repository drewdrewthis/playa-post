import type { Actor } from './actor';

declare const viewerIdBrand: unique symbol;

/**
 * The identity a viewer-scoped read is performed *as*.
 *
 * ADR-0002 §5a, and the mitigation for R14 — the plan's only Critical risk that is
 * not undoable if it leaks. This design deliberately gives up RLS as the enforcement
 * mechanism, which means the database will never catch a wrong `WHERE`. The bug that
 * costs everything is therefore not a missing filter: it is a `viewerId` that arrived
 * from **request input**. One `viewerId: z.string().uuid()` on one procedure is
 * silent, total, trivially exploitable impersonation of every user in the system.
 *
 * The brand is what makes that unwritable rather than merely discouraged: a `string`
 * is not assignable to `ViewerId`, so a value parsed out of a request body cannot
 * reach a visibility function, a query class, or a repository method — all of which
 * take `ViewerId`, never `string`.
 *
 * The brand exists only in the type system. At runtime this is the actor's
 * `userId` and nothing else, which is why passing one to SQL as a bound parameter
 * needs no unwrapping.
 */
export type ViewerId = string & { readonly [viewerIdBrand]: 'ViewerId' };

/**
 * The **only** constructor of a {@link ViewerId}, and it takes an {@link Actor}.
 *
 * ADR-0002:177-179 states that as a hard requirement, and B14 / M2-AC20 asserts it.
 * Do not add a second one — not `viewerIdFromString`, not a test helper, not an
 * "internal" escape hatch. If a call site cannot reach an `Actor`, it is running
 * outside the authenticated request scope and has no business performing a
 * viewer-scoped read; give it its own non-viewer-scoped query instead.
 *
 * Called exactly once per request, in the `authenticatedProcedure` middleware
 * (`shared/trpc/trpc.ts`) — the context boundary ADR-0008 rule 8 names.
 *
 * @param actor - The onboarded product user resolved from a verified access token.
 * @returns That actor's internal user ID, branded so visibility code will accept it.
 */
export function viewerIdFromActor(actor: Actor): ViewerId {
  return actor.userId as ViewerId;
}
