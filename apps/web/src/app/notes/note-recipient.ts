import type { Person } from '@playa-post/contracts';

import { nodeLabel } from '../graph/graph-node-identity';

/**
 * The person a note is being pinned to: who the URL names, and what the compose screen
 * may say about them.
 *
 * Every string here has two forms, and the second is not a degraded one: §6a lets a
 * person be visible on the graph with no name disclosed at all, and the comp — where
 * every person is invented and every person has a name — has no copy for that. "their
 * board" is the copy for it.
 *
 * ⚠ **The name comes from {@link nodeLabel} and from nowhere else.** That is the one
 * implementation of §6a's "a name you may write, or nothing" rule; re-deriving it here
 * would be a second spelling of a privacy rule, which is how two spellings drift.
 */

/**
 * The recipient a `?noteTo=` names, or `null` when it names nobody.
 *
 * ⚠ **Whitespace is nobody.** `?noteTo=%20` used to open the note sheet addressed to
 * `" "`, a screen whose every submit is refused with `MUTATION_PAYLOAD_INVALID` — doomed
 * before it rendered, and refused in a way that says nothing about what went wrong. A
 * truncated or padded link reaches the bulletin sheet instead, which is the harmless
 * reading of one.
 *
 * The trimmed value is what gets passed on, so nothing downstream carries the padding
 * into a payload the server hashes.
 */
export function noteRecipientParam(raw: string | null): string | null {
  const trimmed = raw?.trim() ?? '';

  return trimmed === '' ? null : trimmed;
}

/**
 * The recipient's name, or `null` when the projection disclosed none.
 *
 * `undefined` in — a `noteTo` naming somebody who is not on this viewer's graph, or a
 * graph read that has not landed — is also `null`: **not** a placeholder, and never the
 * `userId`.
 */
export function noteRecipientName(person: Person | undefined): string | null {
  return (person === undefined ? undefined : nodeLabel(person)) ?? null;
}

/** Whose board this is, as a possessive — "Lena’s" or "their". */
function whose(name: string | null): string {
  return name === null ? 'their' : `${name}’s`;
}

/**
 * The compose sheet's title, and the detail sheet's button label — the comp gives both
 * the same sentence (`design/Playa Post.dc.html:285,890`).
 */
export function composeNoteTitle(name: string | null): string {
  return `Pin a note to ${whose(name)} board`;
}

/** The comp's privacy line (`design/Playa Post.dc.html:388`). */
export function notePrivacyLine(name: string | null): string {
  return `Private — it lands on ${whose(name)} board and no one else sees it. This is how you reach people here.`;
}

/**
 * The submit button (`design/Playa Post.dc.html:899`).
 *
 * ⚠ Offline it says **Queue**, and it is not lying to be kind: the write really is
 * queued, and it is queued when connected too (`pending-mutations.ts`). The label names
 * what the person will observe next, which is the only thing that differs.
 */
export function pinNoteButtonLabel(name: string | null, online: boolean): string {
  return online ? `Pin to ${whose(name)} board` : 'Queue note';
}

/** The success toast (`design/Playa Post.dc.html:907`). */
export function notePinnedMessage(name: string | null): string {
  return `Pinned to ${whose(name)} board — only they see it`;
}
