/**
 * `health.check` — the liveness payload Render's health check reads.
 *
 * The literal `'ok'` rather than `string`: the server declares it that way, and a
 * client that can only compare against one value cannot silently start accepting
 * `"degraded"` as healthy.
 */
export interface Health {
  readonly status: 'ok';
}
