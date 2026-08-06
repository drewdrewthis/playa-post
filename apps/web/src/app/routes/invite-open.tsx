import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { JSX } from 'react';
import { useParams } from 'react-router';

import { useApi } from '../api/api-provider';

/**
 * `/invite/:token` — the other half of an invite: preview, then spend.
 *
 * Preview and accept are two steps rather than one link that connects on load, because
 * a link that acts on arrival can be triggered by a preview fetcher, a scanner, or a
 * mis-tap, and a connection is not something to undo afterwards.
 *
 * The preview shows only what `connections.invitations.open` returns — the inviter's
 * id. It deliberately does **not** fetch a person card for it: the viewer has no
 * relationship to the inviter yet, so there is nothing §6a would let them see, and
 * asking would be the frontend proposing a second answer to a visibility question.
 */
export function InviteOpenRoute(): JSX.Element {
  const api = useApi();
  const queryClient = useQueryClient();
  const { token } = useParams<{ token: string }>();

  const invite = useQuery({
    queryKey: ['invite', token],
    queryFn: () => api.query('connections.invitations.open', { token: token ?? '' }),
    enabled: token !== undefined && token !== '',
  });

  const accept = useMutation({
    mutationFn: () => api.mutate('connections.connection.accept', { token: token ?? '' }),
    onSuccess: async () => {
      await queryClient.invalidateQueries();
    },
  });

  if (invite.data === undefined) {
    return (
      <section className="screen">
        <h1 className="screen__title">Invite</h1>
        <p className="screen__notice">
          {invite.error === null ? 'Opening this invite…' : 'This invite cannot be opened.'}
        </p>
      </section>
    );
  }

  return (
    <section className="screen" data-testid="invite-open-view">
      <h1 className="screen__title">You have been invited</h1>
      <p className="screen__lede">
        Accepting connects the two of you. Either of you can set your own private trust
        afterwards; neither of you ever sees the other&rsquo;s.
      </p>

      {accept.data === undefined ? (
        <button
          className="button button--primary"
          data-testid="invite-accept-button"
          type="button"
          onClick={() => accept.mutate()}
          disabled={accept.isPending}
        >
          Accept the invite
        </button>
      ) : (
        <p className="banner banner--good" data-testid="connection-accepted-banner" role="status">
          You are connected.
        </p>
      )}

      {accept.error === null ? null : (
        <p className="form__error" role="alert">
          That invite could not be accepted. It may have been withdrawn or already used.
        </p>
      )}
    </section>
  );
}
