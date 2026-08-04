import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

/**
 * Fitness function for the build-passes-boot-fails gap (reproduced on Render deploy
 * dep-d9p1k2rl550s73fka230).
 *
 * `pnpm build:server:node` only asks esbuild to bundle successfully — nothing in that
 * job, or in any other CI job, ever executes `dist/node/main.js`. tsup's ESM output
 * replaces every bundled CJS dependency's `require` with a shim that throws unless a
 * real `require` is already in scope at runtime, and `pg` (CJS) calls
 * `require('events')` at module load. The result: a green `build:server:node` check
 * and a crash-looping deploy, with no test in between that would have caught it.
 *
 * This suite is that missing test: build the real bundle, boot it with a schema-valid
 * but unreachable database and Supabase project, and assert it reaches the point
 * Fastify logs "Server listening" — the same signal `render-blueprint.fitness.test.ts`
 * proves Render polls at `/healthz`. `/healthz` never touches the database (ADR-0009
 * §5), so no real Postgres or Supabase project is required, matching the `unit`
 * project's no-infrastructure constraint.
 *
 * Deliberately builds fresh on every run (`clean: true` in `tsup.config.ts` already
 * guarantees this) rather than trusting a stale `dist/` from a previous command — a
 * cached bundle from before a config fix would pass for the wrong reason.
 */

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const serverDirectory = join(repositoryRoot, 'apps', 'server');
const bundlePath = join(serverDirectory, 'dist', 'node', 'main.js');

const SERVER_LISTENING_MARKER = 'Server listening';

/**
 * An ephemeral TCP port free at the instant this resolves.
 *
 * Binding port 0 and reading back the OS-assigned port, rather than a fixed literal,
 * is what lets this suite run concurrently with anything else on the box (including,
 * plausibly, another instance of this exact test in a parallel CI shard). The gap
 * between closing the probe and the bundle binding the same port is a theoretical
 * TOCTOU race, not one worth engineering around for a boot smoke test.
 */
function findFreePort(): Promise<number> {
  return new Promise((resolvePort, rejectPort) => {
    const probe = createServer();
    probe.once('error', rejectPort);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      if (address === null || typeof address === 'string') {
        probe.close();
        rejectPort(new Error('failed to allocate a probe port'));
        return;
      }
      const { port } = address;
      probe.close(() => resolvePort(port));
    });
  });
}

interface BootOutput {
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Resolve once the child's stdout carries {@link SERVER_LISTENING_MARKER}, reject on
 * an early exit, a spawn error, or timeout — each with the captured output attached,
 * because a bare "timed out" or "exit code 1" tells a reader nothing about *why* a
 * bundle that built cleanly refused to boot.
 */
function waitForServerListening(
  child: ChildProcessWithoutNullStreams,
  timeoutMs: number,
): Promise<BootOutput> {
  return new Promise((resolveBoot, rejectBoot) => {
    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (run: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      child.stdout.off('data', onStdout);
      child.stderr.off('data', onStderr);
      child.off('exit', onExit);
      child.off('error', onError);
      run();
    };

    const onStdout = (chunk: Buffer): void => {
      stdout += chunk.toString('utf8');
      if (stdout.includes(SERVER_LISTENING_MARKER)) {
        finish(() => resolveBoot({ stdout, stderr }));
      }
    };
    const onStderr = (chunk: Buffer): void => {
      stderr += chunk.toString('utf8');
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      finish(() =>
        rejectBoot(
          new Error(
            `bundle exited before boot (code=${String(code)}, signal=${String(signal)})\n` +
              `--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`,
          ),
        ),
      );
    };
    const onError = (error: Error): void => {
      finish(() => rejectBoot(error));
    };
    const timer = setTimeout(() => {
      finish(() =>
        rejectBoot(
          new Error(
            `timed out after ${String(timeoutMs)}ms waiting for "${SERVER_LISTENING_MARKER}"\n` +
              `--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`,
          ),
        ),
      );
    }, timeoutMs);

    child.stdout.on('data', onStdout);
    child.stderr.on('data', onStderr);
    child.on('exit', onExit);
    child.on('error', onError);
  });
}

describe('server bundle boot (build-passes-boot-fails gap)', () => {
  let child: ChildProcessWithoutNullStreams | undefined;

  afterEach(() => {
    child?.kill('SIGKILL');
    child = undefined;
  });

  it(
    'boots the tsup-built ESM bundle to "Server listening" without a Dynamic require crash',
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
        `pnpm build:server:node failed (status=${String(build.status)}, signal=${String(build.signal)}):\n` +
          `${build.stdout}\n${build.stderr}`,
      ).toBe(0);

      const port = await findFreePort();

      // A controlled, from-scratch environment rather than `...process.env`: the
      // point is to reproduce exactly what Render's `startCommand` runs
      // (`node apps/server/dist/node/main.js`), not whatever happens to be set in
      // the shell running this test.
      child = spawn(process.execPath, [bundlePath], {
        cwd: serverDirectory,
        env: {
          PATH: process.env.PATH ?? '',
          NODE_ENV: 'production',
          HOST: '127.0.0.1',
          PORT: String(port),
          LOG_LEVEL: 'info',
          // Schema-valid, unreachable: `/healthz` never queries the database
          // (ADR-0009 §5), so boot must succeed without a real Postgres. Both the
          // pool (`pg`) and the JWKS resolver (`jose`) connect lazily — see
          // `composition/container.ts` — so constructing them touches no socket.
          DATABASE_URL: 'postgres://app_rw@127.0.0.1:1/nothing_listening_here',
          SUPABASE_URL: 'https://example.supabase.co',
        },
      });

      const { stderr } = await waitForServerListening(child, 15_000);

      // The bug this test exists for: tsup/esbuild's ESM output throws
      // "Dynamic require of ... is not supported" from inside `pg` the instant the
      // bundle is loaded — reaching "Server listening" already proves that did not
      // happen, but asserting it directly names the exact failure mode this guards
      // against rather than only its absence.
      expect(stderr).not.toContain('Dynamic require');
    },
    60_000,
  );
});
