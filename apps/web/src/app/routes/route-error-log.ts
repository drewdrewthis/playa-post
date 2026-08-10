/**
 * What a caught route failure is allowed to say out loud.
 *
 * ⚠ **The raw thrown value never reaches the console.** A boundary that logs the error
 * object logs whatever the throw site attached to it, and the throw sites this boundary
 * catches are ordinary product code: a rejected request carrying an access token, a
 * failed write carrying the bulletin body it could not send. `console` output is read
 * by anyone with the device and shipped verbatim by browser monitoring, so the boundary
 * logs a description built here — name, message, stack — and nothing else.
 */

/**
 * A log line for a thrown value: enough to find the bug, never the payload around it.
 *
 * Own enumerable properties are deliberately not serialised. They are exactly where a
 * throw site hangs its context (`error.response`, `error.input`, `error.session`), and
 * that context is the private data this module exists to keep out of the log.
 */
export function describeThrownForLog(error: unknown): string {
  if (!(error instanceof Error)) {
    // `String()` rather than `JSON.stringify()`: stringify walks a thrown object's
    // properties, which is the leak this function is here to prevent.
    return String(error);
  }

  const headline = `${error.name}: ${error.message}`;

  return error.stack === undefined ? headline : `${headline}\n${error.stack}`;
}

/**
 * A short, stable token for one failure, shown on the crash screen so a user can
 * screenshot it and a maintainer can match two reports to the same bug.
 *
 * Hashed over the thrown value alone, so the same fault yields the same token wherever
 * it is hit; the path is appended in the clear because that is the other half of "where
 * were you when it broke". Not a secret and not a checksum — a label.
 */
export function errorDigest(error: unknown, pathname: string): string {
  return `${hash32(String(error))} · ${pathname}`;
}

/**
 * djb2, as eight hex characters.
 *
 * Deliberately not a cryptographic hash: this is web code, `node:crypto` is off-limits
 * across the boundary rules, and `crypto.subtle.digest` is async — a support label is
 * not worth making the render path await. Collisions are acceptable; the token narrows
 * a search, it does not identify a fault on its own.
 */
function hash32(value: string): string {
  let hash = 5381;

  for (let index = 0; index < value.length; index += 1) {
    // `| 0` after every step keeps the running value a 32-bit signed integer. Without
    // it the multiply drifts past `Number.MAX_SAFE_INTEGER` and starts losing low bits,
    // which would make the token depend on how long the message was.
    hash = ((hash << 5) + hash + value.charCodeAt(index)) | 0;
  }

  return (hash >>> 0).toString(16).padStart(8, '0');
}
