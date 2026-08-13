import { useQuery } from '@tanstack/react-query';
import { useEffect, useState, type JSX } from 'react';

import type { Person } from '@playa-post/contracts';

import { useApi } from '../api/api-provider';
import { ConnectionRequestInbox } from '../connections/connection-request-inbox';
import { summariseGraph } from '../graph/graph-counts';
import { GraphNetwork } from '../graph/graph-network';
import { GRAPH_LIST_QUERY_KEY } from '../graph/graph-query-keys';
import { IntroInbox } from '../intros/intro-inbox';
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
    queryKey: GRAPH_LIST_QUERY_KEY,
    queryFn: () => api.query('graph.list', undefined),
  });

  /*
   * Tapping a node is selection, not navigation (the comp's `sel`): the person sheet
   * rises over this screen and closing it reveals the graph exactly as it was — same
   * viewport, same zoom, no history entry.
   *
   * The selection holds the {@link Person} itself, not a userId to look up again in the
   * graph query's data — a sheet whose subject is derived from a server cache unmounts
   * whenever `data` is momentarily `undefined` or the person leaves the payload,
   * mid-interaction. Accepted cost: the sheet's identity block is a snapshot from tap
   * time and does not follow a disclosure change until closed and reopened. What the
   * sheet is *for* — the viewer's own trust — is never snapshotted; it is the sheet's
   * live `['connection', userId]` query.
   */
  const [selectedPerson, setSelectedPerson] = useState<Person | null>(null);

  const network = graph.data;
  const summary = summariseGraph(network?.people ?? []);
  const hasNetwork = network !== undefined && summary.people > 0;

  /*
   * The one place the snapshot must yield: if a *settled* refetch positively omits the
   * selected person — connection removed, visibility withdrawn — the sheet closes
   * rather than keep rendering an identity the server has stopped disclosing
   * (ADR-0002's fail-closed posture). An in-flight refetch (`undefined`) never closes
   * it; that transience is the reason the snapshot exists.
   */
  useEffect(() => {
    if (
      network !== undefined &&
      selectedPerson !== null &&
      !network.people.some((person) => person.userId === selectedPerson.userId)
    ) {
      setSelectedPerson(null);
    }
  }, [network, selectedPerson]);

  return (
    <section className="screen screen--canvas" data-testid="graph-home">
      <div className="screen__chrome">
        {/*
         * No actions beside the title, and both absences are deliberate: composing is the
         * shell's FAB on every screen (`tab-bar.tsx`), and inviting is the You screen's
         * standing CONNECT card. The comp has no invite control here at all — the button
         * this header used to carry was a remnant of the pre-design wave
         * ([#142](https://github.com/drewdrewthis/playa-post/issues/142)).
         */}
        <h1 className="sr-only">Your graph</h1>

        {network === undefined ? null : (
          <p className="graph-counts" data-testid="graph-counts">
            {summary.people} PEOPLE · {summary.trusted} TRUSTED
          </p>
        )}

        {/*
         * Above the canvas, because a connection request and an intro are both requests to
         * add an edge to the very thing drawn below them — and because somebody has been
         * waiting on this viewer to answer. Each renders nothing at all when there is
         * nothing waiting, so the screen is unchanged for everybody with no ask in front
         * of them.
         *
         * ⚠ Two components rather than one merged inbox, and two sections when both have
         * rows. They answer different procedures with different consequences — accepting a
         * request connects you *now*, accepting an introduction connects you moments later
         * — and a merged list would need a discriminator whose only job is to keep two
         * Accept buttons from calling each other's mutation.
         *
         * Connection requests sit first: they come from somebody holding this viewer's own
         * published link, which is the more immediate thing to answer.
         */}
        <ConnectionRequestInbox />
        <IntroInbox />
      </div>

      {/* One slot, two occupants: the canvas when there is a network, the empty-state
          message centred in the same space when there is not. */}
      {hasNetwork ? (
        <GraphNetwork graph={network} onOpenPerson={setSelectedPerson} />
      ) : (
        <p className="screen__empty">
          Nobody yet. Share your link from the You screen.
        </p>
      )}

      {selectedPerson === null ? null : (
        <PersonSheet
          // A new person is a new sheet: no draft state may survive a subject change.
          key={selectedPerson.userId}
          person={selectedPerson}
          onClose={() => {
            setSelectedPerson(null);
          }}
        />
      )}
    </section>
  );
}
