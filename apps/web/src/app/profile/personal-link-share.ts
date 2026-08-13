/**
 * Where a personal link points, and what to say when handing one over (issue #206).
 *
 * The sibling of `invite-share.ts`, and deliberately not a rewrite of it: an invite token
 * and a personal slug are two different objects with two different promises, and one
 * `shareUrl(kind, value)` would be a function whose two branches say opposite things about
 * what happens when somebody taps.
 *
 * The route is `/c/:slug` (`app/router.tsx`). Short on purpose — this is an address people
 * read aloud, photograph, and type from a QR that failed to scan.
 */

/**
 * The absolute link that opens somebody's personal page.
 *
 * ⚠ The slug is percent-encoded. It is base64url, so today no character in it needs
 * escaping — and that is exactly the kind of fact that stops being true when somebody
 * changes the alphabet to make the link prettier, at which point an unescaped `/` would
 * truncate every shared URL with no error to explain it.
 *
 * ⚠ **The origin is the caller's own `window.location.origin`, never a server-built URL.**
 * A link assembled server-side bakes whichever host served the request into something people
 * paste into chats, and one minted through a preview deployment would outlive the
 * deployment.
 */
export function personalLinkUrl(origin: string, slug: string): string {
  return `${origin.replace(/\/+$/, '')}/c/${encodeURIComponent(slug)}`;
}

/**
 * The consent line alone, with no link folded into it.
 *
 * ⚠ **This is the whole `text` field whenever `url` travels alongside it** —
 * `navigator.share({ text: personalLinkShareBlurb(), url })`. Folding the link into `text`
 * too meant a share target that reads both fields verbatim — the OS share sheet's own Copy
 * action among them — pasted the link twice (issue #160, on the invite path).
 *
 * ⚠ The wording says **"they ask, you answer"** rather than the invite card's "nothing
 * happens until you both consent". Both are true; only the second describes what the person
 * receiving *this* link is about to see. Somebody who taps expecting to be connected and
 * lands on a request button has been misled by the message that came with it.
 */
export function personalLinkShareBlurb(): string {
  return 'Connect with me on Playa Post. Tap to send me a request — I will see it and answer.';
}

/**
 * The blurb and the link, combined into one self-contained string.
 *
 * ⚠ **For the clipboard fallback only** — the one shape with exactly one field, so the link
 * has to travel inside it or not at all. Never pass this as `navigator.share`'s `text` when
 * a `url` field is also going along; see {@link personalLinkShareBlurb}.
 */
export function personalLinkShareText(url: string): string {
  return `${personalLinkShareBlurb()}\n${url}`;
}
