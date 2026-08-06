import { TRPCError } from '@trpc/server';

import { ApplicationError } from '../../../shared/errors/application-error';
import { authenticatedProcedure, router } from '../../../shared/trpc/trpc';
import type { AcceptInviteService } from '../application/accept-invite.service';
import type { CreateInviteService } from '../application/create-invite.service';
import type { GetConnectionQuery } from '../application/get-connection.query';
import type { OpenInviteService } from '../application/open-invite.service';
import type { SetConnectionTrustService } from '../application/set-connection-trust.service';
import { NotConnectedError } from '../domain/connection.errors';
import {
  CannotAcceptOwnInviteError,
  InvitationUnavailableError,
} from '../domain/invitation.errors';

import { presentConnection, type PresentedConnection } from './connection.presenter';
import { getConnectionInput } from './get-connection.input';
import {
  presentInvite,
  presentOpenedInvite,
  type PresentedInvite,
  type PresentedOpenedInvite,
} from './invitation.presenter';
import { inviteTokenInput } from './invite-token.input';
import { setConnectionTrustInput } from './set-connection-trust.input';

/** The application operations this router speaks for. One use case, one procedure. */
export interface ConnectionsRouterDependencies {
  readonly createInvite: CreateInviteService;
  readonly openInvite: OpenInviteService;
  readonly acceptInvite: AcceptInviteService;
  readonly setConnectionTrust: SetConnectionTrustService;
  readonly getConnection: GetConnectionQuery;
}

/**
 * Give an {@link ApplicationError} the transport status it deserves.
 *
 * Without this, an application error escapes as tRPC's default
 * `INTERNAL_SERVER_ERROR` — a 500 for a spent invite. The stable application code
 * travels either way (`trpc.ts`'s `errorFormatter` lifts it into
 * `data.applicationCode`), so this decides the HTTP status and nothing else.
 *
 * **`INVITATION_UNAVAILABLE` and `NOT_CONNECTED` are both `NOT_FOUND`, and that is the
 * security-relevant choice.** A `FORBIDDEN` on either would confirm that the thing
 * exists and belongs to somebody else — an invite token that was once real, or a
 * connection between two other people. `NOT_FOUND` is the same answer the caller would
 * get for something that never existed, which is what ADR-0002 §10 asks for and what
 * B10's indistinguishability row measures.
 *
 * `CANNOT_ACCEPT_OWN_INVITE` is a **conflict**: the token was fine, the caller's
 * relationship to it is what refuses — and they already know they minted it, so naming
 * the reason discloses nothing.
 */
function asTrpcError(error: ApplicationError): TRPCError {
  const code =
    error instanceof InvitationUnavailableError || error instanceof NotConnectedError
      ? 'NOT_FOUND'
      : error instanceof CannotAcceptOwnInviteError
        ? 'CONFLICT'
        : 'BAD_REQUEST';

  return new TRPCError({ code, message: error.message, cause: error });
}

/**
 * Run one application operation and map its refusals onto the wire.
 *
 * Every procedure body is the same three steps — call one operation, present the
 * result, translate an `ApplicationError` — so the translation lives here once. A
 * `try`/`catch` copied into five procedures is five places for the next `catch` to be
 * forgotten, and a forgotten one is a 500 carrying a message that was written for a
 * log rather than for a caller.
 */
async function present<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ApplicationError) {
      throw asTrpcError(error);
    }
    throw error;
  }
}

/**
 * The connections module's tRPC surface.
 *
 * Three namespaces, because they are three different things a client does: mint and
 * open invites, accept one into a connection, and record a private opinion about
 * somebody you are connected to.
 *
 * **No procedure takes an identifier for its caller** — `invitations.create` takes no
 * input at all, and the two that name another person call the field `subjectUserId` /
 * `otherUserId` rather than `userId`. ADR-0002:180-181 forbids the latter and
 * `tests/fitness/viewer-id-provenance.fitness.test.ts` walks this router to prove it.
 *
 * Every procedure is `authenticatedProcedure`: each one either creates state attached
 * to an actor or reads state scoped to one, so there is no version of any of them that
 * a signed-out caller could sensibly be given.
 */
export function createConnectionsRouter(dependencies: ConnectionsRouterDependencies) {
  return router({
    invitations: router({
      /** Mint an invite for the caller. The token is returned once and never listed. */
      create: authenticatedProcedure.mutation(
        async ({ ctx }): Promise<PresentedInvite> =>
          present(async () =>
            presentInvite(await dependencies.createInvite.create({ inviterId: ctx.actor.userId })),
          ),
      ),

      /**
       * What does this token get me?
       *
       * A query, not a mutation: opening changes nothing. Only accepting spends the
       * token, so a client may show the invite and let the person decide.
       */
      open: authenticatedProcedure
        .input(inviteTokenInput)
        .query(
          async ({ input }): Promise<PresentedOpenedInvite> =>
            present(async () => presentOpenedInvite(await dependencies.openInvite.open(input))),
        ),
    }),

    connection: router({
      /** Spend the token and connect. Idempotent for whoever spent it (M2-AC18). */
      accept: authenticatedProcedure
        .input(inviteTokenInput)
        .mutation(async ({ ctx, input }): Promise<PresentedConnection> =>
          present(async () => {
            const { connection } = await dependencies.acceptInvite.accept({
              actorId: ctx.actor.userId,
              token: input.token,
            });

            // Freshly accepted, so there is no trust yet — and there must not be a
            // shortcut that assumes so: `null` here is the same "unset" the read path
            // returns, not a placeholder for a value this response declined to fetch.
            return presentConnection({ status: connection.status, trust: null });
          }),
        ),

      /** The caller's own view of one connection, including their own trust. */
      get: authenticatedProcedure
        .input(getConnectionInput)
        .query(async ({ ctx, input }): Promise<PresentedConnection> =>
          present(async () =>
            presentConnection(
              await dependencies.getConnection.get({
                actorId: ctx.actor.userId,
                otherUserId: input.otherUserId,
              }),
            ),
          ),
        ),
    }),

    trust: router({
      /**
       * Record the caller's private, directional trust in somebody.
       *
       * Returns nothing. A response echoing the value back would be correct and
       * harmless today and is still not worth having: every payload that carries a
       * trust value is a payload M2-AC3 has to re-prove is unreachable by the other
       * party, and the caller already knows what they just sent.
       */
      set: authenticatedProcedure
        .input(setConnectionTrustInput)
        .mutation(async ({ ctx, input }): Promise<void> => {
          await present(async () => {
            await dependencies.setConnectionTrust.set({
              actorId: ctx.actor.userId,
              subjectUserId: input.subjectUserId,
              trust: input.trust,
            });
          });
        }),
    }),
  });
}

/** The connections router's type, for the root router to mount it by. */
export type ConnectionsRouter = ReturnType<typeof createConnectionsRouter>;
