import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { HEALTH_PATH, readHealth } from './health';

/**
 * ADR-0001 proved reversibility by asserting the Node and Cloudflare entrypoints
 * returned byte-identical health output. ADR-0009 leaves one entrypoint, so that
 * drift is gone — but a new one took its place: `render.yaml`'s `healthCheckPath`
 * is now a second copy of this path, living in a file no compiler reads. A
 * mismatch does not fail a build; it fails a deploy by leaving the service
 * permanently unhealthy and unrouted. So it is asserted here instead.
 */
const blueprint = readFileSync(
  fileURLToPath(new URL('../../../../../render.yaml', import.meta.url)),
  'utf8',
);

describe('health', () => {
  it('answers with the liveness payload and nothing else', () => {
    expect(readHealth()).toEqual({ status: 'ok' });
  });

  it('is the path Render polls', () => {
    expect(blueprint).toContain(`healthCheckPath: ${HEALTH_PATH}`);
  });
});
