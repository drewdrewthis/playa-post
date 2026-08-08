/**
 * Where an invite token points, and what to say when handing one over.
 *
 * The comp shows `playapost.net/j/RAE-7Q2F`. This app's invite route is `/invite/:token`
 * (`app/router.tsx`); the route is what has to work, so the path here is that one and not
 * the prototype's.
 */

/**
 * The absolute link that opens an invite.
 *
 * ⚠ The token is percent-encoded. It is minted from a CSPRNG and is a **bearer
 * credential** — whoever holds it can connect — so a `/` or `#` passing through unencoded
 * would truncate the link and hand somebody an invite that cannot be accepted, with no
 * error to explain it.
 */
export function inviteUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, '')}/invite/${encodeURIComponent(token)}`;
}

/**
 * What the share sheet sends alongside the link.
 *
 * States the consent rule, because a bare URL in a messaging app asks somebody to trust a
 * link with no stated purpose — and consent is the thing this product will not skip. The
 * wording is the comp's own: *"Nothing happens until you both consent."*
 */
export function inviteShareText(url: string): string {
  return `Connect with me on Playa Post. Nothing happens until you both consent.\n${url}`;
}
