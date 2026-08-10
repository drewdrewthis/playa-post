import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import type {
  MutationPath,
  ProcedureInput,
  ProcedureOutput,
  QueryPath,
} from '@playa-post/contracts';

import { ApiClientProvider } from '../api/api-provider';
import type { PlayaPostClient } from '../api/client';

/**
 * The harness `*.unit.test.tsx` files mount components through.
 *
 * ⚠ **Imported only by tests**, and it deliberately imports no test runner: the pieces
 * here are a fake and a mount, both of which are ordinary code. Keeping vitest out means
 * the file typechecks under `apps/web`'s own tsconfig with nothing special added to it.
 *
 * The API double is a **fake, not a mock** — an in-memory implementation of
 * {@link PlayaPostClient}, an interface this app owns — so tests assert on what a
 * component *sent* and what it did with the answer, never on a call sequence.
 *
 * ⚠ The container is attached to `document.body`. jsdom will not move focus into a
 * detached tree, and "focus enters the sheet on open, and returns to the opener on
 * close" is a contract these tests exist to hold.
 */

/** One call a component made, in the order it made it. */
export interface FakeApiCall {
  readonly kind: 'query' | 'mutate';
  readonly path: string;
  readonly input: unknown;
}

/**
 * What the fake answers with, keyed by procedure path.
 *
 * A route may return a value, a promise, or throw — throwing is how a test says "the
 * server refused this", which is a state these screens have to render.
 */
export type FakeApiRoutes = Readonly<Record<string, (input: unknown) => unknown>>;

/** A {@link PlayaPostClient} that answers from a table and records what it was asked. */
export interface FakeApi extends PlayaPostClient {
  readonly calls: readonly FakeApiCall[];
}

/**
 * Build the fake.
 *
 * An unrouted path rejects loudly rather than resolving `undefined`: a component reading
 * a procedure the test never anticipated is a fact worth failing on, not a silent empty
 * state that makes an assertion pass for the wrong reason.
 */
export function createFakeApi(routes: FakeApiRoutes): FakeApi {
  const calls: FakeApiCall[] = [];

  async function run(kind: 'query' | 'mutate', path: string, input: unknown): Promise<unknown> {
    calls.push({ kind, path, input });

    const route = routes[path];

    if (route === undefined) {
      throw new Error(`the fake API has no route for ${kind} ${path}`);
    }

    return await route(input);
  }

  return {
    calls,

    // The casts are the price of a non-generic implementation behind a generic
    // signature; `run` genuinely cannot know the output type, and `unknown` is the
    // honest intermediate.
    query<Path extends QueryPath>(
      path: Path,
      input: ProcedureInput<Path>,
    ): Promise<ProcedureOutput<Path>> {
      return run('query', path, input) as Promise<ProcedureOutput<Path>>;
    },

    mutate<Path extends MutationPath>(
      path: Path,
      input: ProcedureInput<Path>,
    ): Promise<ProcedureOutput<Path>> {
      return run('mutate', path, input) as Promise<ProcedureOutput<Path>>;
    },
  };
}

/** A mounted tree, and the two things a test does to one after mounting it. */
export interface MountedTree {
  readonly container: HTMLElement;
  /** Run something that changes React state, then let the render land. */
  run(action: () => void): Promise<void>;
  /** Let every in-flight query and mutation settle and re-render. */
  settle(): Promise<void>;
  unmount(): Promise<void>;
}

const actEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

// React 18 gates `act` on this flag; without it every render logs "The current testing
// environment is not configured to support act(...)" over the assertions.
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Mount one component over a fake API and a throwaway query cache.
 *
 * `retry: false` matches `ApiProvider`'s own default and is what keeps a refusal from
 * being retried behind the assertion that it was rendered.
 */
export async function mountWithApi(element: ReactNode, api: PlayaPostClient): Promise<MountedTree> {
  const container = document.createElement('div');

  document.body.append(container);

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false, staleTime: 0 },
      mutations: { retry: false },
    },
  });

  const root: Root = createRoot(container);

  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <ApiClientProvider client={api}>{element}</ApiClientProvider>
      </QueryClientProvider>,
    );
  });

  const tree: MountedTree = {
    container,

    async run(action: () => void): Promise<void> {
      await act(async () => {
        action();
      });
      await tree.settle();
    },

    /*
     * Three turns of the macrotask queue rather than one: a query resolving can start a
     * render that starts a second query (the intro sheet's candidates, then its
     * mutation's invalidation), and a single flush would leave the second one pending
     * with the assertion already running.
     */
    async settle(): Promise<void> {
      for (let turn = 0; turn < 3; turn += 1) {
        await act(async () => {
          await new Promise<void>((resolve) => {
            setTimeout(resolve, 0);
          });
        });
      }
    },

    async unmount(): Promise<void> {
      await act(async () => {
        root.unmount();
      });

      container.remove();
      queryClient.clear();
    },
  };

  await tree.settle();

  return tree;
}

/** The element a test is about to press, or the assertion fails with a useful name. */
export function requireElement<T extends Element = HTMLElement>(
  container: ParentNode,
  selector: string,
): T {
  const found = container.querySelector<T>(selector);

  if (found === null) {
    throw new Error(`expected the tree to contain ${selector}`);
  }

  return found;
}

/**
 * Type into a controlled field the way React will notice.
 *
 * ⚠ Assigning `.value` and dispatching `input` is not enough on its own: React installs
 * a value tracker on the DOM node and skips the change event when the node's own value
 * already matches what it just wrote. Going through the prototype's setter is what
 * bypasses that tracker — the standard workaround, restated here so no test has to
 * rediscover why its keystrokes did nothing.
 */
export function setFieldValue(
  field: HTMLInputElement | HTMLTextAreaElement,
  value: string,
): void {
  const prototype =
    field instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;

  Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(field, value);
  field.dispatchEvent(new Event('input', { bubbles: true }));
}

/** Every match, as an array — `querySelectorAll` returns a `NodeList`. */
export function allElements<T extends Element = HTMLElement>(
  container: ParentNode,
  selector: string,
): readonly T[] {
  return [...container.querySelectorAll<T>(selector)];
}
