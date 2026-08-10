import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createDatabaseConnection, type DatabaseConnection } from '@playa-post/database';
import { startPostgresTestDatabase, type PostgresTestDatabase } from '@playa-post/testing';

// None of these exist yet. `createCreateInviteService` / `createOpenInviteService` are
// the application layer M2.5 owes; `createPostgresInvitationRepository` is the
// persistence adapter behind them. Failing on module resolution here is the legible
// failure this seam should show until the coder writes them.
import { createCreateInviteService } from '../../application/create-invite.service';
import { createOpenInviteService } from '../../application/open-invite.service';
import { InvitationUnavailableError } from '../../domain/invitation.errors';
import { createPostgresInvitationRepository } from '../../persistence/postgres-invitation.repository';

/**
 * `specs/features/invitations.feature` — the three `@integration` scenarios,
 * M2-AC17.
 *
 * Seeds `app.users` and `app.invitations` directly with the superuser test client
 * (raw SQL), the same discipline `actor-resolution.integration.test.ts` uses: seeding
 * through the port under test would make "spent"/"revoked" fixtures circular.
 *
 * `app.invitations`' exact columns are not pinned by any ADR (see
 * `connections-schema-migration.integration.test.ts`'s header comment) — the shape
 * seeded here (`id, inviter_id, token, status, created_at`) is this test's own
 * working assumption, recorded as an AC ambiguity in the L2 test-writing report; the
 * coder's migration must match it or this file's seeding helper needs updating in the
 * same PR.
 */
describe('invitations (invitations.feature @integration, M2-AC17)', () => {
  let testDatabase: PostgresTestDatabase;
  let database: DatabaseConnection;

  beforeAll(async () => {
    testDatabase = await startPostgresTestDatabase();
    await testDatabase.client.query(`alter role app_rw with password 'app_rw_in_a_throwaway_container'`);
    database = createDatabaseConnection({
      connectionString: asRole(testDatabase.connectionString, 'app_rw', 'app_rw_in_a_throwaway_container'),
    });
  }, 300_000);

  afterEach(async () => {
    await testDatabase.truncateAllTables();
  });

  afterAll(async () => {
    await database?.destroy();
    await testDatabase?.stop();
  });

  async function seedOnboardedUser(handle: string): Promise<string> {
    const { rows } = await testDatabase.client.query<{ id: string }>(
      `insert into app.users (auth_user_id, handle, display_name, created_at)
       values ($1, $2, $3, now()) returning id`,
      [randomUUID(), handle, handle],
    );
    const id = rows[0]?.id;
    if (id === undefined) {
      throw new Error('seedOnboardedUser: insert returned no row');
    }
    return id;
  }

  async function seedInvitation(
    inviterId: string,
    status: 'pending' | 'accepted' | 'revoked',
    // Explicit override for tests that need a specific ordering; omitted callers keep
    // the column stamped at insert time, same as before.
    createdAt?: Date,
  ): Promise<string> {
    const { rows } = await testDatabase.client.query<{ token: string }>(
      `insert into app.invitations (inviter_id, token, status, created_at)
       values ($1, $2, $3, coalesce($4, now())) returning token`,
      [inviterId, randomUUID().replaceAll('-', ''), status, createdAt ?? null],
    );
    const token = rows[0]?.token;
    if (token === undefined) {
      throw new Error('seedInvitation: insert returned no row');
    }
    return token;
  }

  describe('Scenario: Invite is created as an opaque revocable token', () => {
    it('persists a token that carries no decodable relationship to the inviter', async () => {
      const inviterId = await seedOnboardedUser('dusty_inviter');
      const invitations = createPostgresInvitationRepository({ database });
      const createInvite = createCreateInviteService({ invitations });

      const { token } = await createInvite.create({ inviterId });

      expect(token).not.toContain(inviterId);
      expect(token).not.toContain(Buffer.from(inviterId).toString('base64url'));

      const { rows } = await testDatabase.client.query<{ token: string; inviter_id: string }>(
        `select token, inviter_id from app.invitations where inviter_id = $1`,
        [inviterId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.token).toBe(token);
    });
  });

  describe('Scenario: Creating again while an invite is outstanding returns it (PR #144)', () => {
    it('answers the same token twice and writes one row', async () => {
      const inviterId = await seedOnboardedUser('dusty_repeat_inviter');
      const invitations = createPostgresInvitationRepository({ database });
      const createInvite = createCreateInviteService({ invitations });

      const first = await createInvite.create({ inviterId });
      const second = await createInvite.create({ inviterId });

      expect(second.token).toBe(first.token);
      expect(second.invitationId).toBe(first.invitationId);

      const { rows } = await testDatabase.client.query(
        `select id from app.invitations where inviter_id = $1`,
        [inviterId],
      );
      expect(rows).toHaveLength(1);
    });

    it('mints a fresh token once the outstanding one is spent', async () => {
      const inviterId = await seedOnboardedUser('dusty_spent_reminter');
      const spentToken = await seedInvitation(inviterId, 'accepted');
      const invitations = createPostgresInvitationRepository({ database });
      const createInvite = createCreateInviteService({ invitations });

      const { token } = await createInvite.create({ inviterId });

      expect(token).not.toBe(spentToken);
    });

    it('mints a fresh token once the outstanding one is revoked', async () => {
      const inviterId = await seedOnboardedUser('dusty_revoked_reminter');
      const revokedToken = await seedInvitation(inviterId, 'revoked');
      const invitations = createPostgresInvitationRepository({ database });
      const createInvite = createCreateInviteService({ invitations });

      const { token } = await createInvite.create({ inviterId });

      expect(token).not.toBe(revokedToken);
    });

    it('returns the newer of two outstanding pending invites, and mints no new row', async () => {
      const inviterId = await seedOnboardedUser('dusty_two_pending_inviter');
      // Explicit, strictly-increasing timestamps rather than two `now()`-stamped calls —
      // this proves the `created_at desc` ordering itself, not whatever gap two
      // sequential inserts happen to land.
      const olderToken = await seedInvitation(
        inviterId,
        'pending',
        new Date('2026-01-01T00:00:00.000Z'),
      );
      const newerToken = await seedInvitation(
        inviterId,
        'pending',
        new Date('2026-01-01T00:00:01.000Z'),
      );
      const invitations = createPostgresInvitationRepository({ database });
      const createInvite = createCreateInviteService({ invitations });

      const result = await createInvite.create({ inviterId });

      expect(result.token).toBe(newerToken);
      expect(result.token).not.toBe(olderToken);

      const { rows } = await testDatabase.client.query(
        `select id from app.invitations where inviter_id = $1`,
        [inviterId],
      );
      expect(rows).toHaveLength(2);
    });
  });

  describe('Scenario: Spent invite token cannot be opened again', () => {
    it('answers INVITATION_UNAVAILABLE when opening an already-accepted token', async () => {
      const inviterId = await seedOnboardedUser('dusty_spent_inviter');
      const token = await seedInvitation(inviterId, 'accepted');
      const invitations = createPostgresInvitationRepository({ database });
      const openInvite = createOpenInviteService({ invitations });

      await expect(openInvite.open({ token })).rejects.toMatchObject({
        constructor: InvitationUnavailableError,
        code: 'INVITATION_UNAVAILABLE',
      });
    });
  });

  describe('Scenario: Revoked invite token cannot be opened', () => {
    it('answers INVITATION_UNAVAILABLE when opening a revoked token', async () => {
      const inviterId = await seedOnboardedUser('dusty_revoked_inviter');
      const token = await seedInvitation(inviterId, 'revoked');
      const invitations = createPostgresInvitationRepository({ database });
      const openInvite = createOpenInviteService({ invitations });

      await expect(openInvite.open({ token })).rejects.toMatchObject({
        constructor: InvitationUnavailableError,
        code: 'INVITATION_UNAVAILABLE',
      });
    });
  });
});

/** Mirrors `packages/database/src/database-schema.integration.test.ts`'s helper. */
function asRole(connectionString: string, username: string, password: string): string {
  const url = new URL(connectionString);
  url.username = username;
  url.password = password;
  return url.toString();
}
