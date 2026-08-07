import { useMutation, useQuery } from '@tanstack/react-query';
import type { JSX } from 'react';
import { Link } from 'react-router';

import type { Person } from '@playa-post/contracts';

import { useApi } from '../api/api-provider';
import { PersonIdentity, trustLabel } from '../people/person-identity';

const FIRST_DEGREE = 1;

/**
 * Graph home: the people this viewer is directly connected to.
 *
 * **First degree only** (`degree === 1`). The payload can carry further degrees — the
 * §6a projection decides what a viewer may know about each — but M2's home surface is
 * the direct connections, and filtering here rather than asking the server for a
 * narrower query keeps "who can I see" one answer in one place (ADR-0002 §6).
 */
export function GraphHomeRoute(): JSX.Element {
  const api = useApi();

  const graph = useQuery({
    queryKey: ['graph', 'list'],
    queryFn: () => api.query('graph.list', undefined),
  });

  const invite = useMutation({
    mutationFn: () => api.mutate('connections.invitations.create', undefined),
  });

  const people = (graph.data?.people ?? []).filter((person) => person.degree === FIRST_DEGREE);

  return (
    <section className="screen" data-testid="graph-home">
      <header className="screen__header">
        <h1 className="screen__title">Your graph</h1>
        {/* Composing is the shell's FAB now, on every screen — see `tab-bar.tsx`. */}
        <div className="screen__actions">
          <button
            className="button button--primary"
            data-testid="invite-create-button"
            type="button"
            onClick={() => invite.mutate()}
            disabled={invite.isPending}
          >
            Create an invite
          </button>
        </div>
      </header>

      {invite.data === undefined ? null : (
        <p className="invite-token">
          <span className="invite-token__label">Share this invite</span>
          <code className="invite-token__value" data-testid="invite-token-display">
            {invite.data.token}
          </code>
        </p>
      )}

      {people.length === 0 ? (
        <p className="screen__empty">
          Nobody yet. Create an invite and send it to someone you know.
        </p>
      ) : (
        <ul className="person-list">
          {people.map((person) => (
            <GraphConnection key={person.userId} person={person} />
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * One direct connection: the node you can open, and the edge that proves the
 * connection rendered for this viewer.
 *
 * ⚠ The `data-testid`s are keyed on **handle**, so a person the projection has hidden
 * (no handle at all) carries none — which is correct rather than a gap: there is no
 * public name to key on, and inventing one from `userId` would undo the projection.
 */
function GraphConnection({ person }: { readonly person: Person }): JSX.Element {
  const handle = person.handle;

  return (
    <li
      className="person-list__item"
      data-testid={handle === undefined ? undefined : `graph-connection-edge-${handle}`}
    >
      <Link
        className="person-list__link"
        to={`/people/${person.userId}`}
        data-testid={handle === undefined ? undefined : `graph-connection-node-${handle}`}
      >
        <PersonIdentity identity={person} />
      </Link>
      <span className="person-list__trust">Trust: {trustLabel(person.trust)}</span>
    </li>
  );
}
