import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type JSX } from 'react';
import { useParams } from 'react-router';

import { useApi } from '../api/api-provider';
import { PersonIdentity, trustLabel } from '../people/person-identity';

const TRUST_MIN = 0;
const TRUST_MAX = 100;

/**
 * `/people/:userId` — one person, and the viewer's private directional trust in them.
 *
 * ⚠ **Trust is the viewer's own value and belongs to nobody else.** The server returns
 * `null` for a connection the viewer does not hold (B6), so this screen never has
 * another party's number to render even by accident. The slider is shown only when
 * there is a connection to hold an opinion about.
 *
 * `null` and `0` are two states. The slider's position for an unset value is the
 * minimum, but the label says *Not set* until the viewer saves — otherwise a user who
 * never expressed an opinion would be shown, and would eventually save, a zero they
 * never chose.
 */
export function PersonSheetRoute(): JSX.Element {
  const api = useApi();
  const queryClient = useQueryClient();
  const { userId } = useParams<{ userId: string }>();
  const otherUserId = userId ?? '';

  const graph = useQuery({
    queryKey: ['graph', 'list'],
    queryFn: () => api.query('graph.list', undefined),
  });

  const connection = useQuery({
    queryKey: ['connection', otherUserId],
    queryFn: () => api.query('connections.connection.get', { otherUserId }),
    enabled: otherUserId !== '',
  });

  const [draftTrust, setDraftTrust] = useState<number | null>(null);
  const savedTrust = connection.data?.trust ?? null;

  useEffect(() => {
    setDraftTrust(savedTrust);
  }, [savedTrust]);

  const saveTrust = useMutation({
    mutationFn: (trust: number) =>
      api.mutate('connections.trust.set', { subjectUserId: otherUserId, trust }),
    onSuccess: async () => {
      await queryClient.invalidateQueries();
    },
  });

  const person = graph.data?.people.find((candidate) => candidate.userId === otherUserId);
  const connected = connection.data !== undefined;

  return (
    <section className="screen" data-testid="person-sheet">
      <h1 className="screen__title">
        {person === undefined ? 'Person' : <PersonIdentity identity={person} />}
      </h1>

      {connected ? (
        <>
          <p className="screen__lede">
            Trust is private and one-directional. They never see it, and neither does
            anyone else.
          </p>

          <p className="person-sheet__trust-value" data-testid="person-sheet-trust-value">
            Your trust: {trustLabel(draftTrust)}
          </p>

          <label className="form__field">
            <span className="form__label">Trust</span>
            <input
              className="form__slider"
              type="range"
              aria-label="Trust"
              min={TRUST_MIN}
              max={TRUST_MAX}
              value={draftTrust ?? TRUST_MIN}
              onChange={(event) => setDraftTrust(Number(event.target.value))}
            />
          </label>

          <button
            className="button button--primary"
            data-testid="person-sheet-save-trust-button"
            type="button"
            disabled={draftTrust === null || saveTrust.isPending}
            onClick={() => {
              if (draftTrust !== null) {
                saveTrust.mutate(draftTrust);
              }
            }}
          >
            Save trust
          </button>
        </>
      ) : (
        <p className="screen__notice">
          You are not connected to this person, so there is nothing to set.
        </p>
      )}

      {saveTrust.error === null ? null : (
        <p className="form__error" role="alert">
          That did not save. Try again.
        </p>
      )}
    </section>
  );
}
