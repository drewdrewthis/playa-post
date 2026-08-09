import { useMutation, useQuery } from '@tanstack/react-query';
import { useState, type JSX } from 'react';

import { useApi } from '../api/api-provider';
import { summariseGraph } from '../graph/graph-counts';
import { GraphNetwork } from '../graph/graph-network';
import { PersonSheet } from '../people/person-sheet';

/**
 * Graph home: the viewer's network, drawn as the network it is.
 *
 * The whole payload is rendered, not just the first degree — a graph screen that hides
 * the far half of the graph is a list with extra steps. Which people arrive at all is
 * still the server's answer and only the server's: `app.visible_people` decides who is
 * reachable and `app.visible_edges` decides which of them may be shown knowing each
 * other, so this screen filters nothing (ADR-0002 §6).
 *
 * ⚠ **Nodes come from `people`.** {@link GraphNetwork} drops an edge naming anybody the
 * person list does not contain rather than drawing a node for them; see
 * `graph-layout.ts` for why that is a privacy rule and not a defensive habit.
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

  /*
   * Tapping a node is selection, not navigation (the comp's `sel`): the person sheet
   * rises over this screen and closing it reveals the graph exactly as it was — same
   * viewport, same zoom, no history entry.
   */
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  const network = graph.data;
  const summary = summariseGraph(network?.people ?? []);
  const selectedPerson =
    selectedUserId === null
      ? undefined
      : network?.people.find((person) => person.userId === selectedUserId);

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

      {network === undefined ? null : (
        <p className="graph-counts">
          {summary.people} PEOPLE · {summary.trusted} TRUSTED
        </p>
      )}

      {invite.data === undefined ? null : (
        <p className="invite-token">
          <span className="invite-token__label">Share this invite</span>
          <code className="invite-token__value" data-testid="invite-token-display">
            {invite.data.token}
          </code>
        </p>
      )}

      {network === undefined || summary.people === 0 ? (
        <p className="screen__empty">
          Nobody yet. Create an invite and send it to someone you know.
        </p>
      ) : (
        <GraphNetwork graph={network} onOpenPerson={setSelectedUserId} />
      )}

      {selectedPerson === undefined ? null : (
        <PersonSheet
          person={selectedPerson}
          onClose={() => {
            setSelectedUserId(null);
          }}
        />
      )}
    </section>
  );
}
