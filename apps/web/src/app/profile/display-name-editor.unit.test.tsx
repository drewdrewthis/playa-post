// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import {
  createFakeApi,
  mountWithApi,
  requireElement,
  setFieldValue,
  type MountedTree,
} from '../testing/mount-with-api';

import { DisplayNameEditor } from './display-name-editor';

/**
 * The You screen's rename control, mounted over the fake API (issue #177).
 *
 * ⚠ jsdom, by the per-file pragma above: the `unit` project runs in `node`, and only
 * the files that render React ask for a DOM.
 *
 * What lives here is what `you-screen.spec.ts` cannot hold cheaply — the refusal
 * branch, the guard on an empty name, and the fact that the request carries **only**
 * the name. The round trip through a real server is e2e's job.
 */

const RENAME_PATH = 'identity.updateDisplayName';

let tree: MountedTree | null = null;

afterEach(async () => {
  const mounted = tree;

  tree = null;

  if (mounted !== null) {
    await mounted.unmount();
  }
});

/** Press one of the editor's buttons by test id, and let the render land. */
function press(mounted: MountedTree, testId: string): Promise<void> {
  return mounted.run(() => {
    requireElement<HTMLButtonElement>(mounted.container, `[data-testid="${testId}"]`).click();
  });
}

/** Open the editor and type a name into it. */
async function typeName(mounted: MountedTree, name: string): Promise<void> {
  await press(mounted, 'display-name-edit-button');
  await mounted.run(() => {
    setFieldValue(
      requireElement<HTMLInputElement>(mounted.container, '[data-testid="display-name-input"]'),
      name,
    );
  });
}

function save(mounted: MountedTree): Promise<void> {
  return press(mounted, 'display-name-save-button');
}

describe('DisplayNameEditor', () => {
  it('shows the name with no edit control until the name has loaded', async () => {
    // An edit box that opens empty invites somebody to overwrite a name they cannot
    // see — the one mistake this control must not make easy.
    tree = await mountWithApi(<DisplayNameEditor displayName={undefined} />, createFakeApi({}));

    expect(requireElement(tree.container, '.profile__name').textContent).toBe('You');
    expect(tree.container.querySelector('[data-testid="display-name-edit-button"]')).toBeNull();
  });

  it('opens the field pre-filled with the current name, so a rename starts from what is there', async () => {
    const mounted = await mountWithApi(
      <DisplayNameEditor displayName="Dusty Rhodes" />,
      createFakeApi({}),
    );
    tree = mounted;

    await press(mounted, 'display-name-edit-button');

    expect(
      requireElement<HTMLInputElement>(mounted.container, '[data-testid="display-name-input"]')
        .value,
    ).toBe('Dusty Rhodes');
  });

  it('sends the name and nothing else — no identifier, no handle', async () => {
    // The client half of ADR-0002:180-181. The server refuses an identifier outright
    // (`updateDisplayNameInput` is a `strictObject`); this asserts the app never asks
    // it to, so a reviewer reading either side sees the same contract.
    const api = createFakeApi({ [RENAME_PATH]: () => ({ displayName: 'Dust Storm' }) });

    tree = await mountWithApi(<DisplayNameEditor displayName="Dusty Rhodes" />, api);

    await typeName(tree, 'Dust Storm');
    await save(tree);

    const sent = api.calls.find((call) => call.path === RENAME_PATH);
    expect(sent?.kind).toBe('mutate');
    expect(sent?.input).toEqual({ displayName: 'Dust Storm' });
  });

  it('trims before sending, so the server is never asked to store padding', async () => {
    const api = createFakeApi({ [RENAME_PATH]: () => ({ displayName: 'Dust Storm' }) });

    tree = await mountWithApi(<DisplayNameEditor displayName="Dusty Rhodes" />, api);

    await typeName(tree, '  Dust Storm  ');
    await save(tree);

    expect(api.calls.find((call) => call.path === RENAME_PATH)?.input).toEqual({
      displayName: 'Dust Storm',
    });
  });

  it('closes on the server’s answer, not on submit', async () => {
    const api = createFakeApi({ [RENAME_PATH]: () => ({ displayName: 'Dust Storm' }) });

    tree = await mountWithApi(<DisplayNameEditor displayName="Dusty Rhodes" />, api);

    await typeName(tree, 'Dust Storm');
    await save(tree);

    // Back to a heading. The name it shows is still the prop's — the screen around it
    // owns re-reading `graph.list`, which the mutation invalidated.
    expect(tree.container.querySelector('[data-testid="display-name-form"]')).toBeNull();
    expect(requireElement(tree.container, '.profile__name').textContent).toBe('Dusty Rhodes');
  });

  it('refuses to send an empty name rather than asking the server to refuse it', async () => {
    const api = createFakeApi({ [RENAME_PATH]: () => ({ displayName: 'unreachable' }) });

    tree = await mountWithApi(<DisplayNameEditor displayName="Dusty Rhodes" />, api);

    await typeName(tree, '   ');

    const saveButton = requireElement<HTMLButtonElement>(
      tree.container,
      '[data-testid="display-name-save-button"]',
    );
    expect(saveButton.disabled).toBe(true);

    await save(tree);
    expect(api.calls.some((call) => call.path === RENAME_PATH)).toBe(false);
  });

  it('renders the refusal and keeps the typed name so it is not lost', async () => {
    const api = createFakeApi({
      [RENAME_PATH]: () => {
        throw new Error('the server refused this');
      },
    });

    tree = await mountWithApi(<DisplayNameEditor displayName="Dusty Rhodes" />, api);

    await typeName(tree, 'Dust Storm');
    await save(tree);

    expect(requireElement(tree.container, '[data-testid="display-name-error"]').textContent).toBe(
      'That name did not save. Try again.',
    );
    // Still in the form, still holding what they typed: a refusal that closed the
    // editor would make somebody type their name a second time.
    expect(
      requireElement<HTMLInputElement>(tree.container, '[data-testid="display-name-input"]').value,
    ).toBe('Dust Storm');
  });

  it('drops the edit on Cancel without sending anything', async () => {
    const api = createFakeApi({ [RENAME_PATH]: () => ({ displayName: 'unreachable' }) });

    tree = await mountWithApi(<DisplayNameEditor displayName="Dusty Rhodes" />, api);

    await typeName(tree, 'Dust Storm');
    await press(tree, 'display-name-cancel-button');

    expect(api.calls.some((call) => call.path === RENAME_PATH)).toBe(false);
    expect(requireElement(tree.container, '.profile__name').textContent).toBe('Dusty Rhodes');
  });

  it('clears a previous refusal when the editor is opened again', async () => {
    // Otherwise somebody who cancelled after a failure re-opens the field and is told
    // their new attempt has already failed.
    let refuse = true;
    const api = createFakeApi({
      [RENAME_PATH]: () => {
        if (refuse) {
          throw new Error('the server refused this');
        }

        return { displayName: 'Dust Storm' };
      },
    });

    tree = await mountWithApi(<DisplayNameEditor displayName="Dusty Rhodes" />, api);

    await typeName(tree, 'Dust Storm');
    await save(tree);
    expect(tree.container.querySelector('[data-testid="display-name-error"]')).not.toBeNull();

    await press(tree, 'display-name-cancel-button');
    refuse = false;
    await press(tree, 'display-name-edit-button');

    expect(tree.container.querySelector('[data-testid="display-name-error"]')).toBeNull();
  });
});
