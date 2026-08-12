import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Every background loop in `entrypoints/` is actually started, and actually stopped
 * (issue #169).
 *
 * **The gap this closes is that `main.ts` cannot be unit-tested.** It is a script with
 * top-level side effects — it loads configuration, builds the container, registers signal
 * handlers and listens — so importing it in a suite boots a server. Everything it wires is
 * therefore covered by tests of the *pieces*: `startPurgePoller` has its own unit suite,
 * `buildAppContainer` has `container.unit.test.ts`, and both stay green for a `main.ts`
 * that never calls one of them. A poller that is never started does not throw, does not
 * log, and does not fail anything — it simply never runs, and the first evidence is a
 * table that has not been swept in months.
 *
 * `container-notification-wiring.integration.test.ts` exists for the same class of silent
 * omission one layer down (an unregistered outbox consumer). This is that idea applied to
 * the loops themselves, and it is a source-level check because the fact being asserted is
 * a fact about a file that cannot be run.
 *
 * ⚠ **The poller set is read off the filesystem, not listed here.** A test naming
 * `startPurgePoller` would prove only today's poller and would not notice a fourth added
 * next quarter and left unstarted — which is the same silent failure one iteration later.
 * Adding `entrypoints/<loop>/start-<loop>-poller.ts` is therefore enough to be covered.
 */
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const entrypoints = join(repositoryRoot, 'apps', 'server', 'src', 'entrypoints');
const mainPath = join(entrypoints, 'http', 'main.ts');

interface Poller {
  /** Repository-relative path, for a failure message that names the file. */
  readonly file: string;
  /** The exported starter, e.g. `startPurgePoller`. */
  readonly starter: string;
}

/** Every `start-*-poller.ts` under `entrypoints/`, with the function each one exports. */
function declaredPollers(): readonly Poller[] {
  const found: Poller[] = [];

  function walk(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);

      if (entry.isDirectory()) {
        walk(path);
        continue;
      }

      if (
        !entry.name.startsWith('start-') ||
        !entry.name.endsWith('-poller.ts') ||
        entry.name.includes('.test.')
      ) {
        continue;
      }

      // Read the exported name rather than deriving it from the filename: the two agree
      // today by convention, and a check that assumed they must would fail for a reason
      // that has nothing to do with what it is guarding.
      const starter = /export function (\w+)\s*\(/.exec(readFileSync(path, 'utf8'))?.[1];
      if (starter === undefined) {
        throw new Error(`${entry.name} exports no starter function this check could find`);
      }

      found.push({ file: relative(repositoryRoot, path).split(sep).join('/'), starter });
    }
  }

  walk(entrypoints);
  return found.sort((left, right) => left.starter.localeCompare(right.starter));
}

/**
 * The name `main.ts` binds a started poller to.
 *
 * The nearest preceding `const` rather than a pattern spanning the assignment, because
 * one of the three is started inside a ternary (`notificationFlushPoller`) and any regex
 * wide enough to cross that is wide enough to match the wrong statement later.
 */
function bindingFor(source: string, starter: string): string | undefined {
  const callIndex = source.search(new RegExp(`\\b${starter}\\s*\\(`));
  if (callIndex === -1) {
    return undefined;
  }

  const bindings = [...source.slice(0, callIndex).matchAll(/const\s+(\w+)\s*=/g)];
  return bindings.at(-1)?.[1];
}

describe('main.ts starts every background loop (issue #169)', () => {
  const source = readFileSync(mainPath, 'utf8');
  const pollers = declaredPollers();

  it('finds the pollers it is meant to be checking', () => {
    // Non-vacuity. Everything below is "for each poller", which passes trivially against
    // an empty list — the shape this check would silently rot into if the directory
    // layout ever moved out from under the walk above.
    //
    // A fourth poller failing this line is the intended path, not a nuisance: add the name
    // and the start/stop checks below cover it from then on without being touched.
    expect(pollers.map((poller) => poller.starter)).toEqual([
      'startNotificationFlushPoller',
      'startOutboxDrainerPoller',
      'startPurgePoller',
    ]);
  });

  it.each(pollers)('starts $starter', ({ starter, file }) => {
    expect(source, `${file} is never started by main.ts`).toMatch(
      new RegExp(`\\b${starter}\\s*\\(`),
    );
  });

  it.each(pollers)('stops $starter during shutdown', ({ starter, file }) => {
    // Started and never stopped is the quieter half of the same bug: Render sends SIGTERM
    // on every deploy, and a loop still running while `container.dispose()` drains the
    // pool turns a clean shutdown into failed queries mid-round.
    const binding = bindingFor(source, starter);
    expect(binding, `${file} is never started by main.ts`).toBeDefined();

    const shutdown = source.slice(source.indexOf('async function shutdown'));
    // `?.` allowed: the flush poller is conditional on push being configured, and a
    // loop that was never started has nothing to stop.
    expect(shutdown, `${String(binding)} is never stopped`).toMatch(
      new RegExp(`\\b${String(binding)}\\??\\.stop\\(`),
    );
  });
});
