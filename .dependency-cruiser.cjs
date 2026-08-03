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

/**
 * Node's standard library. Forbidden in `domain/` and `application/` because a
 * module that reaches for `node:crypto`, `node:fs`, or a socket is a module that
 * has chosen a host — which is precisely the portability property ADR-0009 claims
 * this rule protects, now that the second (`platform: 'neutral'`) bundle that used
 * to fail on a Node builtin in module code is gone.
 *
 * The shape this forces is dependency inversion, not deprivation: declare the port
 * in `domain/` (`TokenGenerator`, `Clock`) and implement it in an infrastructure
 * adapter that may import `node:crypto` freely. M2's CSPRNG invite token
 * (M2-AC17) is the first real instance.
 *
 * Both spellings are listed. `node:crypto` is what this repo writes, but bare
 * `crypto` resolves to the same core module, and a boundary rule with a
 * one-token bypass is the "green while enforcing nothing" failure the TypeScript 7
 * pin already taught us to design against.
 */
const NODE_BUILTINS =
  'assert|buffer|child_process|cluster|dgram|dns|events|fs|http|http2|https|inspector|module|net|os|path|perf_hooks|process|querystring|readline|repl|stream|string_decoder|timers|tls|tty|url|util|v8|vm|worker_threads|zlib|crypto';

module.exports = {
  forbidden: [
    {
      name: 'no-domain-to-infrastructure',
      severity: 'error',
      comment:
        'Addendum §2: neither the domain nor an application service may import tRPC, React, ' +
        'Kysely, Supabase clients, Fastify, a logging implementation, or a Node builtin — nor ' +
        'its own module’s persistence, entrypoints, or composition root. Infrastructure ' +
        'implements interfaces defined by the domain; never the reverse. Define the interface ' +
        '(repository, TokenGenerator, Clock) in domain/ and let persistence/ or an adapter ' +
        'implement it.',
      // The name is the addendum §19 / M1-AC2 identifier and is kept stable, but the
      // scope is domain AND application: an application service holding a Kysely
      // handle or a `node:crypto` import has picked a database and a host just as
      // surely as a domain entity would. Non-capturing group so `$1` below stays the
      // module name.
      from: { path: `apps/server/src/modules/([^/]+)/(?:domain|application)/` },
      to: {
        path: [
          // Own module only. A reach into ANOTHER module's persistence is
          // `no-cross-module-persistence`'s violation, and letting both rules fire on
          // one import would make each look load-bearing while masking the other —
          // which the fitness suite's "no rule masks another" assertion fails on.
          'apps/server/src/modules/$1/persistence/',
          'apps/server/src/entrypoints/',
          'apps/server/src/composition/',
          `node_modules/(${FORBIDDEN_IN_DOMAIN})(/|$)`,
          `^(${FORBIDDEN_IN_DOMAIN})(/|$)`,
          '^node:',
          `^(${NODE_BUILTINS})$`,
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
