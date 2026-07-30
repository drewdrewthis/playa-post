/**
 * Executable form of architecture-addendum §19 ("Import and Module Boundary Rules").
 *
 * These are not style preferences. Each rule below is one of the addendum's
 * "at minimum, automated checks must prevent" bullets, and each has a
 * deliberately-violating fixture under `tests/fitness/__fixtures__/<rule-name>/`
 * that `tests/fitness/boundaries.fitness.test.ts` proves is still caught.
 *
 * Adding an exception here is almost always the wrong move: the rules describe
 * the dependency direction the system is *for*. If a rule is in the way, change
 * the design (publish a contract, an event, or a coordinating application
 * service — addendum §19) rather than the rule.
 *
 * Path patterns are deliberately UNANCHORED so that one rule matches both the
 * real tree (`apps/server/src/modules/…`) and a fixture that mirrors it
 * (`tests/fitness/__fixtures__/<rule>/apps/server/src/modules/…`). One rule,
 * one fixture, no second copy of the rule to drift.
 *
 * Not yet enforced here, because M1 has no code for them to bind to (adding a
 * rule with nothing to check is the empty abstraction §4 forbids):
 *   - `no-container-outside-composition` — lands with the DI container (M2, ADR-0003).
 *   - `no-sql-outside-persistence`       — an ESLint rule about SQL *literals*,
 *                                          not an import edge; lands with the
 *                                          first repository (M2).
 *
 * @type {import('dependency-cruiser').IConfiguration}
 */

/** Any module directory under the server. */
const SERVER_MODULE = 'apps/server/src/modules/[^/]+';

/**
 * Infrastructure libraries the domain layer is explicitly forbidden to know about
 * (addendum §2). Listed twice per rule on purpose: once as a resolved
 * `node_modules/…` path (dependency is installed) and once as a bare specifier
 * (dependency is not installed in this workspace but the import is still a
 * violation, and must be caught rather than silently ignored).
 */
const FORBIDDEN_IN_DOMAIN = '@trpc|@supabase|kysely|pg|fastify|pino|react|react-dom';
const FORBIDDEN_IN_TRANSPORT = 'kysely|pg';

module.exports = {
  forbidden: [
    {
      name: 'no-domain-to-infrastructure',
      severity: 'error',
      comment:
        'Addendum §2: the domain must not import tRPC, React, Kysely, Supabase clients, HTTP ' +
        'request types, database row types, or logging implementations — nor its own module’s ' +
        'persistence, entrypoints, or composition root. Infrastructure implements interfaces ' +
        'defined by the domain; never the reverse. Define a repository interface in domain/ and ' +
        'let persistence/ implement it.',
      from: { path: `${SERVER_MODULE}/domain/` },
      to: {
        path: [
          `${SERVER_MODULE}/persistence/`,
          'apps/server/src/entrypoints/',
          'apps/server/src/composition/',
          `node_modules/(${FORBIDDEN_IN_DOMAIN})(/|$)`,
          `^(${FORBIDDEN_IN_DOMAIN})(/|$)`,
        ],
      },
    },
    {
      name: 'no-application-to-transport',
      severity: 'error',
      comment:
        'Addendum §2/§6: an application service coordinates one use case and must not depend on ' +
        'transport-specific request/response objects or on an entrypoint. Take a plain input ' +
        'object and return an application result; let the router map it.',
      from: { path: `${SERVER_MODULE}/application/` },
      to: { path: [`${SERVER_MODULE}/transport/`, 'apps/server/src/entrypoints/'] },
    },
    {
      name: 'no-transport-to-persistence',
      severity: 'error',
      comment:
        'Addendum §2/§9: transport code must not reach a repository or the database directly. ' +
        'A tRPC procedure validates input, resolves the actor, invokes ONE application ' +
        'operation, and maps the result. A router that queries is a router that owns ' +
        'authorization decisions it should not own.',
      from: { path: `${SERVER_MODULE}/transport/` },
      to: {
        path: [
          `${SERVER_MODULE}/persistence/`,
          `node_modules/(${FORBIDDEN_IN_TRANSPORT})(/|$)`,
          `^(${FORBIDDEN_IN_TRANSPORT})(/|$)`,
        ],
      },
    },
    {
      name: 'no-web-to-server-internals',
      severity: 'error',
      comment:
        'Addendum §19: apps/web may consume `@playa-post/contracts` and nothing else from the ' +
        'server. Importing a server internal couples the client to a module’s private shape and ' +
        'quietly re-creates the "trust the frontend" failure the trust model forbids (§15).',
      from: { path: 'apps/web/' },
      to: { path: 'apps/server/' },
    },
    {
      name: 'no-cross-module-persistence',
      severity: 'error',
      comment:
        'Addendum §19: a module must not import another module’s persistence implementation. ' +
        'Cross-module interaction goes through a small public application interface, a published ' +
        'event, a shared contract with clear ownership, or a coordinating application service — ' +
        'never a reach-in to someone else’s repository.',
      from: { path: 'apps/server/src/modules/([^/]+)/' },
      to: {
        path: 'apps/server/src/modules/[^/]+/persistence/',
        pathNot: 'apps/server/src/modules/$1/',
      },
    },
  ],

  options: {
    doNotFollow: { path: '(^|/)node_modules(/|$)' },
    exclude: { path: '(^|/)(dist|dev-dist|coverage)(/|$)' },
    // Count type-only imports. A domain file that imports a Kysely type is still
    // a domain file that knows about Kysely.
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      mainFields: ['module', 'main', 'types', 'typings'],
      extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json'],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
