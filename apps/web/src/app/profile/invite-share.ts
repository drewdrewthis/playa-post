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
 * The consent line alone, with no link folded into it.
 *
 * ⚠ **This is the whole `text` field whenever `url` travels alongside it** —
 * `navigator.share({ text: inviteShareBlurb(), url })`. Folding the link into `text` too
 * (the pre-#160 shape) meant a share target that reads both fields verbatim — the OS
 * share sheet's own Copy action among them — pasted the link twice. `inviteShareText`
 * below is the combined form, for the one case that has nowhere else to put the link.
 * The wording is the comp's own: *"Nothing happens until you both consent."*
 */
export function inviteShareBlurb(): string {
  return 'Connect with me on Playa Post. Nothing happens until you both consent.';
}

/**
 * The blurb and the link, combined into one self-contained string.
 *
 * ⚠ **For the clipboard fallback only** — the one shape with exactly one field, so the
 * link has to travel inside it or not at all. Never pass this as `navigator.share`'s
 * `text` when a `url` field is also going along; see {@link inviteShareBlurb} for that
 * case, and issue #160 for what happens when the two overlap.
 */
export function inviteShareText(url: string): string {
  return `${inviteShareBlurb()}\n${url}`;
}
