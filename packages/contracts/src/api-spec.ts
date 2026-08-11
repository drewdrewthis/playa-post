import type { CreateBulletinRequest, BulletinIdRequest, Bulletin, Board, BoardRequest, VisibleBulletin } from './bulletins';
import type { GetConnectionRequest, Connection, Invite, InviteTokenRequest, OpenedInvite, SetTrustRequest } from './connections';
import type { Graph } from './graph';
import type { Health } from './health';
import type {
  CompleteOnboardingRequest,
  OnboardedUser,
  SetVisibilityRequest,
  StoredDisplayName,
  UpdateDisplayNameRequest,
  VisibilitySetting,
} from './identity';
import type {
  DecideIntroRequest,
  IntroInboxRow,
  IntroOutboxRow,
  IntroPerson,
  IntroRequestReceipt,
  IntroViaCandidatesRequest,
  RequestIntroRequest,
  RespondToIntroRequest,
} from './intros';
import type {
  HiddenBulletin,
  ModerationTargetRequest,
  ReportBulletinRequest,
  RestoredBulletin,
} from './moderation';
import type { Note, NoteIdRequest, PinnedNote, PinNoteRequest } from './notes';
import type {
  GroupedNotification,
  NotificationDismissal,
  NotificationIdRequest,
  NotificationSeenMark,
  SubscribeToPushRequest,
} from './notifications';
import type { MutationBatch, SubmitMutationsRequest } from './sync';
import type {
  NotifyMeDesignation,
  NotifyMeQuery,
  RenameSavedViewRequest,
  SavedView,
  SavedViewDeletion,
  SavedViewIdRequest,
  SavedViewListing,
  SaveViewRequest,
  SetSavedViewNotifyRequest,
  UpdateNotifyMeQueryRequest,
} from './views';

/**
 * One procedure of the client-facing API: what it takes, and what it gives back.
 *
 * The two phantom-ish members are read only by the type-level helpers below; nothing
 * constructs a `ProcedureSpec` at runtime. Keeping them as properties rather than two
 * bare type parameters is what lets {@link QueryInput} and friends index into the spec
 * by name instead of pattern-matching on a tuple.
 */
export interface ProcedureSpec<TInput, TOutput> {
  readonly input: TInput;
  readonly output: TOutput;
}

/** A read. Safe to repeat, cacheable, never changes server state. */
export type QuerySpec<TInput, TOutput> = ProcedureSpec<TInput, TOutput> & { readonly kind: 'query' };

/** A write. */
export type MutationSpec<TInput, TOutput> = ProcedureSpec<TInput, TOutput> & {
  readonly kind: 'mutation';
};

/**
 * The whole client-facing surface, keyed by dotted procedure path.
 *
 * **Hand-declared here, never re-exported from `apps/server`.** A re-export would ship
 * every module's private presenter as the public client surface, invert the workspace
 * layering (`packages/` depending on `apps/`), and pass `no-web-to-server-internals`
 * only because that rule is a direct-edge rule. The README's promotion rule forbids it
 * in as many words: *"if `apps/web` needs a server internal, the answer is a contract
 * designed for the client, not a re-export of the internal"*.
 *
 * ⚠ **Drift from the real router is a compile error, not a runtime surprise.**
 * `tests/fitness/contracts-api-parity.fitness.test.ts` asserts, at type level, that
 * every key here is mutually assignable with `inferRouterInputs`/`inferRouterOutputs`
 * of the router the server actually serves, and — at runtime — that the key set equals
 * `procedurePaths(appRouter())` in both directions. Adding a procedure without a key
 * here, or changing a presenter without changing the type here, fails `pnpm typecheck`
 * on the PR that causes it. See ADR-0014.
 *
 * `void` means "this procedure takes no input" / "this procedure returns no body" —
 * the same thing tRPC infers for a procedure with no `.input()` and a `Promise<void>`
 * resolver.
 */
export interface PlayaPostApi {
  'health.check': QuerySpec<void, Health>;

  'identity.completeOnboarding': MutationSpec<CompleteOnboardingRequest, OnboardedUser>;
  'identity.updateDisplayName': MutationSpec<UpdateDisplayNameRequest, StoredDisplayName>;
  'identity.visibility.get': QuerySpec<void, VisibilitySetting>;
  'identity.visibility.set': MutationSpec<SetVisibilityRequest, VisibilitySetting>;

  'connections.invitations.create': MutationSpec<void, Invite>;
  'connections.invitations.open': QuerySpec<InviteTokenRequest, OpenedInvite>;
  'connections.connection.accept': MutationSpec<InviteTokenRequest, Connection>;
  'connections.connection.get': QuerySpec<GetConnectionRequest, Connection>;
  'connections.trust.set': MutationSpec<SetTrustRequest, void>;

  'graph.list': QuerySpec<void, Graph>;

  'bulletins.create': MutationSpec<CreateBulletinRequest, Bulletin>;
  'bulletins.archive': MutationSpec<BulletinIdRequest, Bulletin>;
  'bulletins.getById': QuerySpec<BulletinIdRequest, VisibleBulletin>;
  'bulletins.listMine': QuerySpec<void, readonly Bulletin[]>;
  'bulletins.board': QuerySpec<BoardRequest, Board>;
  /**
   * The caller's Dismissed category — the same {@link Board} shape as `bulletins.board`,
   * so one card renders both (#170). Takes no input: there is one dismissed list a caller
   * may read, and no filter over it.
   */
  'bulletins.dismissed': QuerySpec<void, Board>;

  'moderation.report': MutationSpec<ReportBulletinRequest, HiddenBulletin>;
  'moderation.dismiss': MutationSpec<ModerationTargetRequest, HiddenBulletin>;
  'moderation.undismiss': MutationSpec<ModerationTargetRequest, RestoredBulletin>;

  'notes.pin': MutationSpec<PinNoteRequest, PinnedNote>;
  'notes.list': QuerySpec<void, readonly Note[]>;
  /**
   * One note in full, for the expanded view (#176, decision D14).
   *
   * Answers the same {@link Note} a row of `notes.list` is: the sheet shows more of the
   * note, never more about it. `NOTE_GONE` covers both "not yours" and "no such note".
   */
  'notes.getById': QuerySpec<NoteIdRequest, Note>;

  'intros.viaCandidates': QuerySpec<IntroViaCandidatesRequest, readonly IntroPerson[]>;
  'intros.request': MutationSpec<RequestIntroRequest, IntroRequestReceipt>;
  'intros.listInbox': QuerySpec<void, readonly IntroInboxRow[]>;
  'intros.listOutbox': QuerySpec<void, readonly IntroOutboxRow[]>;
  'intros.decide': MutationSpec<DecideIntroRequest, IntroRequestReceipt>;
  'intros.respond': MutationSpec<RespondToIntroRequest, IntroRequestReceipt>;

  'sync.submitMutations': MutationSpec<SubmitMutationsRequest, MutationBatch>;

  'views.saved.list': QuerySpec<void, SavedViewListing>;
  'views.saved.save': MutationSpec<SaveViewRequest, SavedView>;
  'views.saved.rename': MutationSpec<RenameSavedViewRequest, SavedView>;
  'views.saved.delete': MutationSpec<SavedViewIdRequest, SavedViewDeletion>;
  'views.saved.setNotify': MutationSpec<SetSavedViewNotifyRequest, NotifyMeDesignation>;
  'views.notifyMe.update': MutationSpec<UpdateNotifyMeQueryRequest, NotifyMeQuery>;

  'notifications.list': QuerySpec<void, readonly GroupedNotification[]>;
  'notifications.markSeen': MutationSpec<void, NotificationSeenMark>;
  'notifications.dismiss': MutationSpec<NotificationIdRequest, NotificationDismissal>;
  'notifications.push.subscribe': MutationSpec<SubscribeToPushRequest, void>;
}

/** Every dotted path this API serves. */
export type ProcedurePath = keyof PlayaPostApi;

/** The dotted paths that are reads. */
export type QueryPath = {
  [K in ProcedurePath]: PlayaPostApi[K] extends { readonly kind: 'query' } ? K : never;
}[ProcedurePath];

/** The dotted paths that are writes. */
export type MutationPath = {
  [K in ProcedurePath]: PlayaPostApi[K] extends { readonly kind: 'mutation' } ? K : never;
}[ProcedurePath];

/** What procedure `P` accepts. */
export type ProcedureInput<P extends ProcedurePath> = PlayaPostApi[P]['input'];

/** What procedure `P` returns. */
export type ProcedureOutput<P extends ProcedurePath> = PlayaPostApi[P]['output'];
