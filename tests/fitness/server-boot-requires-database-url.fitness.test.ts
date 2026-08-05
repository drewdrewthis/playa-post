import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

/**
 * M1-AC10 (implementation-plan.md:220-228): "Booting the server with a required env
 * var absent exits non-zero within 2 s and prints the missing key's name and expected
 * type, printing no value of any other secret."
 *
 * **Vacuous until now.** M1a's schema defaulted every key, so this AC had nothing to
 * exercise; `DATABASE_URL` is M2's first genuinely required, undefaulted variable
 * (m2-lane-briefs.md:365-366 — "L1 proves it"). This extends
 * `server-bundle-boot.fitness.test.ts`'s pattern exactly: build the real
 * `tsup`-bundled `dist/node/main.js` and spawn it as a child process — the same
 * `node apps/server/dist/node/main.js` Render runs — rather than importing
 * `loadServerConfiguration` in-process, because the AC is about what a real boot
 * prints and how fast it exits, not about `ConfigurationError`'s shape in isolation
 * (that half is already unit-tested — see `packages/configuration/src/
 * load-configuration.unit.test.ts`, M1a status note in the plan).
 *
 * `main.ts` builds configuration and the container **before** registering signal
 * handlers or opening a socket (main.ts's own docstring), so a missing `DATABASE_URL`
 * must fail synchronously, before "Server listening" would ever appear.
 */

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const serverDirectory = join(repositoryRoot, 'apps', 'server');
const bundlePath = join(serverDirectory, 'dist', 'node', 'main.js');

/**
 * A value that must never appear in the child's combined output — stands in for "any
 * other secret's value" (M1-AC10). `SUPABASE_URL` is not itself a secret (CLAUDE.md),
 * but this is the harness's proof that boot-failure output is scoped to the single
 * offending key and does not echo the rest of the environment wholesale.
 */
const CANARY_SUPABASE_URL = 'https://canary-project-should-not-leak.supabase.co';

interface BootFailure {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly output: string;
  readonly elapsedMs: number;
}

function waitForExit(
  child: ChildProcessWithoutNullStreams,
  timeoutMs: number,
): Promise<BootFailure> {
  const startedAt = Date.now();
  return new Promise((resolveExit, rejectExit) => {
    let output = '';
    let settled = false;

    const finish = (run: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      run();
    };

    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
    });
    child.on('exit', (exitCode, signal) => {
      finish(() =>
        resolveExit({ exitCode, signal, output, elapsedMs: Date.now() - startedAt }),
      );
    });
    child.on('error', (error) => {
      finish(() => rejectExit(error));
    });

    const timer = setTimeout(() => {
      finish(() =>
        rejectExit(
          new Error(
            `expected the bundle to exit within ${String(timeoutMs)}ms on a missing ` +
              `DATABASE_URL, but it was still running.\n--- output so far ---\n${output}`,
          ),
        ),
      );
    }, timeoutMs);
  });
}

describe('server boot fails fast on a missing DATABASE_URL (M1-AC10, load-bearing from M2)', () => {
  let child: ChildProcessWithoutNullStreams | undefined;

  afterEach(() => {
    child?.kill('SIGKILL');
    child = undefined;
  });

  it(
    'exits non-zero within 2s, names DATABASE_URL and its expected type, and prints no other secret\'s value',
    async () => {
      const build = spawnSync('pnpm', ['build:server:node'], {
        cwd: repositoryRoot,
        encoding: 'utf8',
        timeout: 40_000,
      });
      if (build.error !== undefined) {
        throw build.error;
      }
      expect(
        build.status,
        `pnpm build:server:node failed:\n${build.stdout}\n${build.stderr}`,
      ).toBe(0);

      child = spawn(process.execPath, [bundlePath], {
        cwd: serverDirectory,
        env: {
          PATH: process.env.PATH ?? '',
          NODE_ENV: 'production',
          HOST: '127.0.0.1',
          PORT: '0',
          LOG_LEVEL: 'info',
          // DATABASE_URL deliberately absent — the one thing under test.
          SUPABASE_URL: CANARY_SUPABASE_URL,
        },
      });

      const result = await waitForExit(child, 2_000);

      expect(result.exitCode, `boot output:\n${result.output}`).not.toBe(0);
      expect(result.elapsedMs).toBeLessThan(2_000);
      expect(result.output).toContain('DATABASE_URL');
      // "expected type" per M1-AC10's own wording — ConfigurationError today names
      // only the offending key (packages/configuration/src/load-configuration.ts),
      // not what was expected of it. This is the assertion that is currently red:
      // the message carries no type/shape information for a reader to act on.
      expect(result.output).toMatch(/string|url|required|expected/i);
      expect(result.output).not.toContain(CANARY_SUPABASE_URL);
    },
    60_000,
  );
});
