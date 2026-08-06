import type { CreatedInvite } from '../application/create-invite.service';
import type { OpenedInvite } from '../application/open-invite.service';

/**
 * A freshly minted invite, as this API renders one.
 *
 * The token and nothing else. It is shown **once**, at creation, and there is no
 * procedure anywhere that lists or re-reads it: an invite is a bearer credential, so a
 * listing endpoint would turn one stolen session into every outstanding invite that
 * account ever minted.
 */
export interface PresentedInvite {
  readonly token: string;
}

/**
 * What the holder of a live token is told.
 *
 * An identifier, never a person. ADR-0002 §6a requires every representation of a
 * person to be projected through `app.visible_people`'s disclosure level, and the
 * opener is by definition not yet connected to the inviter — so there is no disclosure
 * level under which a name could belong here. Adding one would be exactly the "author
 * card built by joining `app.users` directly" that §6a forbids.
 */
export interface PresentedOpenedInvite {
  readonly inviterId: string;
}

/** Project a minted invite for the person who minted it. */
export function presentInvite(invite: CreatedInvite): PresentedInvite {
  return { token: invite.token };
}

/** Project an opened invite for whoever holds the token. */
export function presentOpenedInvite(invite: OpenedInvite): PresentedOpenedInvite {
  return { inviterId: invite.inviterId };
}
