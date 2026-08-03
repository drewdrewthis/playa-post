// DELIBERATE VIOLATION — do not fix. See tests/fitness/__fixtures__/README.md
//
// An application service holding a Fastify type. The rule's `from` covers
// `application/` as well as `domain/` (ADR-0009 review B3): a service that knows
// the HTTP server library has picked a host, and coordinating one use case never
// requires that knowledge.
//
// It imports `fastify` rather than reaching into transport/ on purpose — a
// transport import here would trip `no-application-to-transport` instead, and the
// fitness suite fails a fixture that trips a rule other than its own.
//
// The correct shape is a plain input object in, an application result out; the
// router maps both.

import type { FastifyRequest } from 'fastify';

export class ArchiveBulletinService {
  async execute(request: FastifyRequest): Promise<void> {
    void request;
  }
}
