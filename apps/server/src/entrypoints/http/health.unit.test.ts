import { describe, expect, it } from 'vitest';

import { readHealth } from './health';

// The blueprint coupling this file used to assert lives in
// tests/fitness/render-blueprint.fitness.test.ts — a cross-artifact deployment
// check does not belong in a package unit test, and reading render.yaml from
// here coupled the payload assertion to the file's existence.
describe('readHealth', () => {
  it('answers with the liveness payload and nothing else', () => {
    expect(readHealth()).toEqual({ status: 'ok' });
  });
});
