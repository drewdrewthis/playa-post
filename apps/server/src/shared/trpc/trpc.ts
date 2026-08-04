import { initTRPC, TRPCError } from '@trpc/server';

import { OnboardingRequiredError } from '../auth/authentication.errors';
import { viewerIdFromActor } from '../auth/viewer-id';
import { ApplicationError } from '../errors/application-error';

import type { RequestContext } from './request-context';

/**
 * The one tRPC instance for the server.
 *
 * `initTRPC` must be called exactly once per application: every router and procedure
 * has to be built from the same instance or their context types diverge and the root
 * router stops type-checking. Modules import `router` / `publicProcedure` /
 * `authenticatedProcedure` from here and never call `initTRPC` themselves.
 */
const t = initTRPC.context<RequestContext>().create({
  /**
   * Lift an {@link ApplicationError}'s stable code onto the wire.
   *
   * tRPC's own `data.code` is its transport vocabulary (`UNAUTHORIZED`, `FORBIDDEN`,
   * `BAD_REQUEST`) and is not the product's. M2-AC18 wants a **stable application
   * code** a client can branch on — `ONBOARDING_REQUIRED`, `BULLETIN_GONE`,
   * `HANDLE_IMMUTABLE` — so it travels beside the transport code rather than
   * overwriting it. Nothing else is added: no stack, no cause chain, no internal
   * detail (addendum §25).
   */
  errorFormatter({ shape, error }) {
    return error.cause instanceof ApplicationError
      ? { ...shape, data: { ...shape.data, applicationCode: error.cause.code } }
      : shape;
  },
});

/** Build a router. Every module's `<name>.router.ts` uses this one. */
export const router = t.router;

/**
 * Lets a caller invoke procedures in-process with a hand-built context.
 *
 * The honest way to test transport behavior without binding a socket — and the way
 * the outbox drainer (M2.14) will invoke procedures from a non-HTTP entrypoint.
 */
export const createCallerFactory = t.createCallerFactory;

/**
 * A procedure anyone may call, signed in or not.
 *
 * Use it only where "unauthenticated" is a *designed* answer — liveness, and the
 * sign-in surfaces L1 owns. Everything that reads or writes product data is
 * {@link authenticatedProcedure}: visibility is the product (ADR-0002), so
 * "public" is the exception that has to argue for itself.
 */
export const publicProcedure = t.procedure;

/**
 * A procedure that runs only for an onboarded actor, and hands it the branded
 * {@link import('../auth/viewer-id').ViewerId} to read with.
 *
 * The three refusals are M2-AC2 exactly:
 *
 * | Credentials | Result |
 * |---|---|
 * | none, or a non-bearer scheme | 401 `UNAUTHORIZED` |
 * | present but unverifiable — forged, expired, wrong algorithm, `service_role` | 401 `UNAUTHORIZED` |
 * | verified, but no onboarded `app.users` row | 403 + `ONBOARDING_REQUIRED` |
 *
 * The first two produce a **byte-identical** response: same status, same code, same
 * message, no `cause`. A client cannot learn from the reply whether its token was
 * well-formed, which keeps the auth boundary from becoming an oracle for probing the
 * verifier (ADR-0002 §10 as house style).
 *
 * This middleware is also the single call site of `viewerIdFromActor` — the context
 * boundary ADR-0008 rule 8 names and ADR-0002 §5a requires. A `ViewerId` therefore
 * cannot exist in this system without an authenticated actor behind it, which is R14's
 * only mitigation.
 */
export const authenticatedProcedure = t.procedure.use(async ({ ctx, next }) => {
  const { authentication } = ctx;

  switch (authentication.kind) {
    case 'anonymous':
    case 'invalid-token':
      throw new TRPCError({ code: 'UNAUTHORIZED' });

    case 'not-onboarded':
      throw new TRPCError({ code: 'FORBIDDEN', cause: new OnboardingRequiredError() });

    case 'authenticated':
      return next({
        ctx: {
          ...ctx,
          actor: authentication.actor,
          viewerId: viewerIdFromActor(authentication.actor),
        },
      });
  }
});
