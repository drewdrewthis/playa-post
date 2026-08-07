import { TRPCError } from '@trpc/server';

import { ApplicationError } from '../../../shared/errors/application-error';
import { authenticatedProcedure, router } from '../../../shared/trpc/trpc';
import type { ArchiveBulletinService } from '../application/archive-bulletin.service';
import type { CreateBulletinService } from '../application/create-bulletin.service';
import type { GetBulletinQuery } from '../application/get-bulletin.query';
import type { ListBoardQuery } from '../application/list-board.query';
import type { ListMyBulletinsQuery } from '../application/list-my-bulletins.query';
import { BulletinGoneError } from '../domain/bulletin.errors';

import { boardQueryInput } from './board-query.input';
import { bulletinIdInput } from './bulletin-id.input';
import {
  presentBoard,
  presentBulletin,
  presentVisibleBulletin,
  type PresentedBoard,
  type PresentedBulletin,
  type PresentedVisibleBulletin,
} from './bulletin.presenter';
import { createBulletinCommandFields, createBulletinInput } from './create-bulletin.input';

/** The application operations this router speaks for. One use case, one procedure. */
export interface BulletinsRouterDependencies {
  readonly createBulletin: CreateBulletinService;
  readonly archiveBulletin: ArchiveBulletinService;
  readonly getBulletin: GetBulletinQuery;
  readonly listMyBulletins: ListMyBulletinsQuery;
  readonly listBoard: ListBoardQuery;
}

/**
 * Give an {@link ApplicationError} the transport status it deserves.
 *
 * Without this, an application error escapes as tRPC's default
 * `INTERNAL_SERVER_ERROR` — a 500 for an archived bulletin. The stable application code
 * travels either way (`trpc.ts`'s `errorFormatter` lifts it into
 * `data.applicationCode`), so this decides the HTTP status and nothing else.
 *
 * **`BULLETIN_GONE` is `NOT_FOUND`, and never `FORBIDDEN`.** A 403 would confirm that
 * the bulletin exists and belongs to somebody else; 404 is the same answer the caller
 * would get for something that never existed, which is what ADR-0002 §10 asks for and
 * what B17 measures. It is also M2-AC12's literal requirement — "HTTP 404 with code
 * `BULLETIN_GONE`" — for both the archived and the unauthorized case.
 *
 * Everything else this module raises — `INVALID_BOARD_QUERY`,
 * `BULLETIN_CONTENT_INVALID` — is the caller's own submission being malformed, which is
 * a **bad request** and may name what they sent without disclosing anything
 * (ADR-0007:53-56 requires exactly that of a refused query).
 */
function asTrpcError(error: ApplicationError): TRPCError {
  const code = error instanceof BulletinGoneError ? 'NOT_FOUND' : 'BAD_REQUEST';

  return new TRPCError({ code, message: error.message, cause: error });
}

/**
 * Run one application operation and map its refusals onto the wire.
 *
 * Every procedure body is the same three steps — call one operation, present the
 * result, translate an `ApplicationError` — so the translation lives here once. A
 * `try`/`catch` copied into five procedures is five places for the next `catch` to be
 * forgotten, and a forgotten one is a 500 carrying a message written for a log rather
 * than for a caller.
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
 * The bulletins module's tRPC surface.
 *
 * Five procedures over two reads of two different shapes, and the split is the §6a
 * rule made visible: `board` and `getById` answer with an authorized bulletin whose
 * author has been projected through `app.visible_people`, while `listMine` answers with
 * the author's own rows, which need no projection because the actor *is* the author.
 *
 * **No procedure takes an identifier for its caller.** `board` takes an optional query
 * string, `create` takes content, and the two that name a bulletin call the field
 * `bulletinId`. ADR-0002:180-181 forbids `viewerId`/`userId`/`actorId`/`ownerId` and
 * `tests/fitness/viewer-id-provenance.fitness.test.ts` walks this router to prove it.
 *
 * Every procedure is `authenticatedProcedure`: each one either writes state attached to
 * an actor or reads state scoped to one, so there is no version of any of them a
 * signed-out caller could sensibly be given.
 */
export function createBulletinsRouter(dependencies: BulletinsRouterDependencies) {
  return router({
    /** Post a bulletin. The author is the caller and cannot be anybody else. */
    create: authenticatedProcedure
      .input(createBulletinInput)
      .mutation(async ({ ctx, input }): Promise<PresentedBulletin> =>
        present(async () =>
          presentBulletin(
            await dependencies.createBulletin.create({
              authorId: ctx.actor.userId,
              ...createBulletinCommandFields(input),
            }),
          ),
        ),
      ),

    /**
     * Take your own bulletin down. Idempotent: a second call returns 200 with the
     * first `archivedAt` (M2-AC12).
     */
    archive: authenticatedProcedure
      .input(bulletinIdInput)
      .mutation(async ({ ctx, input }): Promise<PresentedBulletin> =>
        present(async () =>
          presentBulletin(
            await dependencies.archiveBulletin.archive({
              actorId: ctx.actor.userId,
              bulletinId: input.bulletinId,
            }),
          ),
        ),
      ),

    /**
     * One bulletin, if the caller is authorized to see it.
     *
     * Unauthorized, archived, and never-existent are one answer — 404 `BULLETIN_GONE`,
     * byte-identical bodies (M2-AC14, B17).
     */
    getById: authenticatedProcedure
      .input(bulletinIdInput)
      .query(async ({ ctx, input }): Promise<PresentedVisibleBulletin> =>
        present(async () =>
          presentVisibleBulletin(
            await dependencies.getBulletin.getById({
              actorId: ctx.actor.userId,
              bulletinId: input.bulletinId,
            }),
          ),
        ),
      ),

    /** The caller's own bulletins, archived ones included (M2-AC12's retention half). */
    listMine: authenticatedProcedure.query(
      async ({ ctx }): Promise<readonly PresentedBulletin[]> =>
        present(async () =>
          (await dependencies.listMyBulletins.list({ actorId: ctx.actor.userId })).map(
            presentBulletin,
          ),
        ),
    ),

    /**
     * The caller's board.
     *
     * `ctx.viewerId` is minted by the `authenticatedProcedure` middleware from the
     * resolved `Actor` and is the only `ViewerId` in the system — there is exactly one
     * board a caller may read, so there is no parameter that could name a different
     * one (ADR-0002 §5a).
     */
    board: authenticatedProcedure
      .input(boardQueryInput)
      .query(async ({ ctx, input }): Promise<PresentedBoard> =>
        present(async () =>
          presentBoard(
            await dependencies.listBoard.list({
              viewerId: ctx.viewerId,
              ...(input.query === undefined ? {} : { query: input.query }),
            }),
          ),
        ),
      ),
  });
}

/** The bulletins router's type, for the root router to mount it by. */
export type BulletinsRouter = ReturnType<typeof createBulletinsRouter>;
