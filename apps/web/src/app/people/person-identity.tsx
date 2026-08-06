import type { JSX } from 'react';

import type { BulletinAuthor, Person } from '@playa-post/contracts';

/** The identity fields §6a either discloses in full or withholds entirely. */
export type DisclosableIdentity = Pick<Person, 'displayName' | 'handle' | 'avatarUrl'> &
  Pick<BulletinAuthor, 'disclosure'>;

/**
 * Renders a person's name, handle, and avatar — **or nothing at all**.
 *
 * ⚠ **There is no fallback, deliberately.** When the payload omits `displayName`,
 * `handle`, and `avatarUrl`, this renders the private treatment and no derived
 * placeholder: no initials, no truncated `userId`, no "Unknown user #3f2a". Every one
 * of those re-identifies, or partially re-identifies, the person the §6a projection
 * just hid — and each is the kind of "harmless" default a UI acquires without anyone
 * deciding to leak. B5's person-projection sub-case is asserted against exactly this.
 *
 * The server, not this component, decides what is disclosed: an absent field is the
 * projection's answer, not a loading state.
 */
export function PersonIdentity({
  identity,
  className,
}: {
  readonly identity: DisclosableIdentity;
  readonly className?: string;
}): JSX.Element {
  const { displayName, handle, avatarUrl } = identity;

  if (displayName === undefined && handle === undefined && avatarUrl === undefined) {
    return (
      <span className={`person-identity person-identity--private ${className ?? ''}`.trim()}>
        <span className="person-identity__private-mark" aria-hidden="true" />
        <span className="person-identity__private-label">Private connection</span>
      </span>
    );
  }

  return (
    <span className={`person-identity ${className ?? ''}`.trim()}>
      {avatarUrl === undefined ? null : (
        <img className="person-identity__avatar" src={avatarUrl} alt="" />
      )}
      {displayName === undefined ? null : (
        <span className="person-identity__name">{displayName}</span>
      )}
      {handle === undefined ? null : <span className="person-identity__handle">@{handle}</span>}
    </span>
  );
}

/**
 * The viewer's own directional trust, as text.
 *
 * `null` and `0` are two states, not one falsy branch: `null` means the viewer has
 * never set a value, `0` means they deliberately set zero. Collapsing them discards a
 * user's explicit choice, which is why this is a function and not an inline `||`.
 */
export function trustLabel(trust: number | null): string {
  return trust === null ? 'Not set' : String(trust);
}
