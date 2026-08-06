declare const trustBrand: unique symbol;

/**
 * A directional trust value: how much its owner trusts one other person.
 *
 * Branded, so the only way to reach this type is {@link import('./connection-trust.policy').validateTrust}
 * — the compiler enforcing the scale rather than a reviewer remembering it, the same
 * shape `modules/identity/domain/handle.ts` uses for `Handle`.
 *
 * ⚠ **Private to its owner, in every direction, forever** (ADR-0002 B6, PDF §4). A
 * `Trust` reaching a payload the subject or a third party can read is the leak M2-AC3
 * asserts against across six surfaces. It is a separate table for that reason
 * (ratified decision (b)): a read that forgets to join has no trust to leak.
 */
export type Trust = number & { readonly [trustBrand]: 'Trust' };

/** Lowest assignable trust. **A deliberate 0, which is not the same as unset.** */
export const TRUST_MIN = 0;

/** Highest assignable trust. */
export const TRUST_MAX = 100;
