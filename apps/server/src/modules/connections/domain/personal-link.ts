import { nodeCryptoRandomToken } from '../infrastructure/node-crypto-random-token';

import type { RandomTokenSource } from './invite-token';

/**
 * Entropy per personal-link slug.
 *
 * **Half {@link import('./invite-token').INVITE_TOKEN_ENTROPY_BYTES}, and the difference
 * is the whole model** (issue #206, ADR-0018 D2). An invite token is a bearer credential:
 * holding it *is* the connection, so its entropy is anti-forgery and 32 bytes is the
 * cheap way to make guessing pointless. A slug is an **address**: holding it gets you the
 * owner's name and a button that asks them, and the owner still has to say yes — so its
 * entropy only has to defeat enumeration of a live directory.
 *
 * 16 bytes is 128 bits, which is 22 base64url characters. Nothing about the number is a
 * budget: it is what the threat is, stated once, where the constant lives.
 */
export const PERSONAL_LINK_SLUG_ENTROPY_BYTES = 16;

/**
 * A personal link, as `app.personal_links` stores one.
 *
 * One row per owner. There is no `status` and no `revokedAt`, because a rotated link is
 * not a link in a retired state — the row's `slug` is simply a different value, and the
 * old one exists nowhere (ADR-0018 D3). That is what makes a rotated URL answer exactly
 * what an invented one answers, rather than answering it because a reader remembered to
 * filter.
 */
export interface PersonalLink {
  /** `app.users.id`. The primary key: one link per person. */
  readonly ownerId: string;
  /** Opaque, CSPRNG, not derived from the owner. */
  readonly slug: string;
  readonly createdAt: Date;
  /**
   * When the owner last rotated, or `undefined` if they never have.
   *
   * Absent rather than `null`, which is what `exactOptionalPropertyTypes` lets the
   * compiler keep honest. It carries no record of the retired slug and must never grow
   * one — see this module's migration.
   */
  readonly rotatedAt?: Date;
}

/**
 * Mint an opaque personal-link slug.
 *
 * **The owner is accepted and then ignored, by construction**, exactly as
 * {@link import('./invite-token').generateInviteToken} ignores its subject and for a
 * sharper reason: this link is *published*. A slug derived from the owner's id or handle
 * — hashed, encoded, salted, any of it — would make every copy of the URL a standing
 * disclosure of who published it, in a product whose PDF §4 promises there is no people
 * search. Taking the parameter and never reading it puts the guarantee at the call site
 * instead of leaving it an absence a reviewer has to notice.
 *
 * ⚠ **It must also be unlinkable across rotations.** Somebody who saw the old URL must
 * not be able to recognise the new one, or rotating would announce itself to exactly the
 * person it exists to shed. A fresh CSPRNG draw is what makes that true; anything derived
 * from the previous slug, from the owner, or from the clock would not be.
 *
 * @param _owner - The link's owner. Unused, on purpose.
 * @param randomToken - The CSPRNG port. Defaults to this module's Node adapter, which is
 *   the one edge from `domain/` to `infrastructure/` here — the same default
 *   `generateInviteToken` takes, for the same reason: the generator has to be callable as
 *   a plain function, and a test that needs a deterministic slug passes its own.
 * @returns A base64url string of at least 22 characters, unguessable and unlinkable.
 */
export function generatePersonalLinkSlug(
  _owner: { readonly id: string },
  randomToken: RandomTokenSource = nodeCryptoRandomToken,
): string {
  return randomToken(PERSONAL_LINK_SLUG_ENTROPY_BYTES);
}
