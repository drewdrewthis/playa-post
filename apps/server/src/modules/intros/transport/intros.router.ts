import { TRPCError } from '@trpc/server';

import { ApplicationError } from '../../../shared/errors/application-error';
import { authenticatedProcedure, router } from '../../../shared/trpc/trpc';
import type { DecideIntroService } from '../application/decide-intro.service';
import type { ListIntroInboxQuery } from '../application/list-intro-inbox.query';
import type { ListIntroOutboxQuery } from '../application/list-intro-outbox.query';
import type { ListIntroViaCandidatesQuery } from '../application/list-intro-via-candidates.query';
import type { RequestIntroService } from '../application/request-intro.service';
import { IntroUnavailableError } from '../domain/intro-request.errors';

import { decideIntroInput } from './decide-intro.input';
import {
  presentIntroInboxRow,
  presentIntroOutboxRow,
  presentIntroPerson,
  presentIntroRequest,
  type PresentedIntroInboxRow,
  type PresentedIntroOutboxRow,
  type PresentedIntroPerson,
  type PresentedIntroRequest,
} from './intro.presenter';
import { requestIntroCommandFields, requestIntroInput } from './request-intro.input';
import { viaCandidatesInput } from './via-candidates.input';

/** The application operations this router speaks for. One use case, one procedure. */
export interface IntrosRouterDependencies {
  readonly listIntroViaCandidates: ListIntroViaCandidatesQuery;
  readonly requestIntro: RequestIntroService;
  readonly listIntroInbox: ListIntroInboxQuery;
  readonly listIntroOutbox: ListIntroOutboxQuery;
  readonly decideIntro: DecideIntroService;
}

/**
 * Give an {@link ApplicationError} the transport status it deserves.
 *
 * Without this, an application error escapes as tRPC's default
 * `INTERNAL_SERVER_ERROR` — a 500 for an introduction that is simply not on offer. The
 * stable application code travels either way (`trpc.ts`'s `errorFormatter` lifts it into
 * `data.applicationCode`), so this decides the HTTP status and nothing else.
 *
 * **`INTRO_UNAVAILABLE` is `NOT_FOUND`, and never `FORBIDDEN`.** A 403 says "that
 * introduction is real, you just may not have it", which in a product with no people
 * search is most of what an attacker wanted to know; 404 is the same answer a UUID naming
 * nothing gets. The uniformity only holds because the domain raises one error class for
 * every reason a request or a decision failed — see {@link IntroUnavailableError} — so
 * this mapping cannot become an oracle by someone later giving one of those cases its own
 * code.
 *
 * `INTRO_CONTENT_INVALID` is the caller's own submission being malformed, which is a
 * **bad request** and may name what they sent without disclosing anything. It is safe
 * here *because* `request-intro.service.ts` validates content **before** eligibility: it
 * is never the answer to a caller who may not reach the target, so it cannot be used to
 * probe who is reachable.
 */
function asTrpcError(error: ApplicationError): TRPCError {
  const code = error instanceof IntroUnavailableError ? 'NOT_FOUND' : 'BAD_REQUEST';

  return new TRPCError({ code, message: error.message, cause: error });
}

/**
 * Run one application operation and map its refusals onto the wire.
 *
 * Every procedure body is the same three steps — call one operation, present the result,
 * translate an `ApplicationError` — so the translation lives here once, the same shape
 * `notes.router.ts` establishes.
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
 * The intros module's tRPC surface — the one-hop introduction (issue #89).
 *
 * **No procedure takes an identifier for its caller.** `viaCandidates` and `request` take
 * ids naming the *other* parties, which are claims the server authorizes; `listInbox`,
 * `listOutbox` and `decide` name no person at all, because there is exactly one inbox,
 * one outbox, and one via per request that a caller may act as (ADR-0002 §5a).
 * `tests/fitness/viewer-id-provenance.fitness.test.ts` walks this router to prove it.
 *
 * ⚠ **There is deliberately no `getById` and no target-side action.** A `getById` would
 * be a second authorized read of rows the two list procedures already gate, on a surface
 * where "does this id exist" is exactly the question that must stay unanswerable. What
 * the target may *do* after an introduction — connect, ignore — is out of scope for #89:
 * minting a connection from an intro is a new authorization path and belongs to its own
 * issue rather than to a sixth procedure here.
 *
 * Every procedure is `authenticatedProcedure`: each reads or writes state attached to an
 * actor, so there is no version of any of them a signed-out caller could sensibly be
 * given.
 */
export function createIntrosRouter(dependencies: IntrosRouterDependencies) {
  return router({
    /**
     * Who could introduce the caller to a given person.
     *
     * ⚠ **Empty is the answer to every refusal** — the target is at degree 1, three or
     * more hops away, hidden by their own reach setting, deactivated, or nobody at all.
     * This procedure never throws `INTRO_UNAVAILABLE`, because an error where an empty
     * list belongs would distinguish "exists but unreachable" from "does not exist".
     *
     * A client holding an empty list must render a no-candidates state with submit
     * disabled — never an empty chip row above an enabled button.
     */
    viaCandidates: authenticatedProcedure
      .input(viaCandidatesInput)
      .query(async ({ ctx, input }): Promise<readonly PresentedIntroPerson[]> =>
        present(async () =>
          (
            await dependencies.listIntroViaCandidates.list({
              requesterId: ctx.actor.userId,
              targetId: input.targetUserId,
            })
          ).map(presentIntroPerson),
        ),
      ),

    /**
     * Ask a shared connection to introduce you to somebody two hops away.
     *
     * The requester is the caller and cannot be anybody else. An ineligible triple — or
     * a pair that already has an open ask — gets 404 `INTRO_UNAVAILABLE` and leaves no
     * row behind. A malformed note gets 400 `INTRO_CONTENT_INVALID`, and gets it *first*,
     * so the refusal cannot be read as a reachability answer.
     */
    request: authenticatedProcedure
      .input(requestIntroInput)
      .mutation(async ({ ctx, input }): Promise<PresentedIntroRequest> =>
        present(async () =>
          presentIntroRequest(
            await dependencies.requestIntro.request({
              requesterId: ctx.actor.userId,
              ...requestIntroCommandFields(input),
            }),
          ),
        ),
      ),

    /**
     * The caller's dual-role inbox: asks waiting on them, and introductions made to them.
     *
     * `ctx.viewerId` is minted by the `authenticatedProcedure` middleware from the
     * resolved `Actor` and is the only `ViewerId` in the system — there is exactly one
     * inbox a caller may read, so there is no parameter that could name a different one
     * (ADR-0002 §5a).
     */
    listInbox: authenticatedProcedure.query(
      async ({ ctx }): Promise<readonly PresentedIntroInboxRow[]> =>
        present(async () =>
          (await dependencies.listIntroInbox.list({ viewerId: ctx.viewerId })).map(
            presentIntroInboxRow,
          ),
        ),
    ),

    /** What the caller has asked for, in every state — including "not passed on". */
    listOutbox: authenticatedProcedure.query(
      async ({ ctx }): Promise<readonly PresentedIntroOutboxRow[]> =>
        present(async () =>
          (await dependencies.listIntroOutbox.list({ viewerId: ctx.viewerId })).map(
            presentIntroOutboxRow,
          ),
        ),
    ),

    /**
     * Pass an introduction on, or decline it.
     *
     * Only the named via may. Anybody else — the requester, the target, a stranger — gets
     * the same 404 `INTRO_UNAVAILABLE` a request that never existed does, and so does a
     * request already decided. A `pass_on` whose eligibility has lapsed since the ask is
     * refused identically; `decline` is not, because a via must always be able to say no.
     */
    decide: authenticatedProcedure
      .input(decideIntroInput)
      .mutation(async ({ ctx, input }): Promise<PresentedIntroRequest> =>
        present(async () =>
          presentIntroRequest(
            await dependencies.decideIntro.decide({
              introRequestId: input.introRequestId,
              actorId: ctx.actor.userId,
              decision: input.decision,
            }),
          ),
        ),
      ),
  });
}

/** The intros router's type, for the root router to mount it by. */
export type IntrosRouter = ReturnType<typeof createIntrosRouter>;
