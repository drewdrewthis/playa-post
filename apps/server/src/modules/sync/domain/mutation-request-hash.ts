/**
 * `request_hash` — ADR-0005's "sha256 of canonical payload".
 *
 * **Why the payload is canonicalised first.** `JSON.stringify` preserves insertion
 * order, so the same mutation re-serialised by a different client build would hash
 * differently and a legitimate replay would come back as `IDEMPOTENCY_KEY_REUSE` — a
 * user's queued change refused for a key ordering nobody chose. Sorting keys makes the
 * hash a function of the *value*, which is the only thing the comparison means.
 *
 * **Why a hash and not the payload.** The column is compared, never decoded. Storing
 * the canonical text instead would put bulletin titles and bodies in a bookkeeping
 * table that no visibility rule guards and that a support query would print — the same
 * content-hygiene rule that keeps outbox payloads to identifiers (M2-AC16, ADR-0006).
 *
 * **Why WebCrypto and not `node:crypto`.** `no-domain-to-infrastructure` forbids a
 * Node builtin here, and the rule is right: a module that imports one has chosen a
 * host. `globalThis.crypto` is the WHATWG standard, present in Node, a browser, and
 * every edge runtime, so this needs no import at all and picks no host — and hashing is
 * a *pure function of its input*, unlike the invite token's randomness, which is why
 * `modules/connections` correctly declares a port and an adapter for that and this
 * correctly does not.
 */

/**
 * Deterministic serialisation: object keys sorted, `undefined` members dropped.
 *
 * Arrays keep their order — an array's order is part of its value, unlike an object's
 * key order. `undefined` is dropped rather than encoded because it cannot survive the
 * JSON round trip the payload has already made, so treating `{ a: undefined }` and
 * `{}` as different hashes would refuse a replay of the same wire bytes.
 */
function canonicalize(value: unknown): string {
  if (value === undefined) {
    return 'null';
  }
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(',')}]`;
  }

  const members = Object.entries(value as Record<string, unknown>)
    .filter(([, member]) => member !== undefined)
    .sort(([one], [other]) => (one < other ? -1 : one > other ? 1 : 0))
    .map(([key, member]) => `${JSON.stringify(key)}:${canonicalize(member)}`);

  return `{${members.join(',')}}`;
}

/** Lowercase hex, because the column is `text` and a hash people compare by eye is hex. */
function toHex(digest: ArrayBuffer): string {
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * The fingerprint stored beside a mutation's result and compared on every replay.
 *
 * @param payload - The envelope's payload, exactly as it arrived.
 * @returns 64 lowercase hex characters.
 */
export async function hashMutationRequest(payload: unknown): Promise<string> {
  const encoded = new TextEncoder().encode(canonicalize(payload));

  return toHex(await crypto.subtle.digest('SHA-256', encoded));
}
