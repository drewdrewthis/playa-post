import { useState, type FormEvent, type JSX } from 'react';
import { useNavigate } from 'react-router';

import { BULLETIN_TYPE, type BulletinType } from '@playa-post/contracts';

import { useOffline } from '../offline/offline-provider';
import { queueMutation } from '../offline/pending-mutations';

const BULLETIN_TYPES: readonly BulletinType[] = Object.values(BULLETIN_TYPE);

/**
 * Compose a bulletin.
 *
 * ⚠ **Always through the offline queue**, online or not. Posting straight to the
 * network when the device happens to be connected would make the queued path the
 * rarely-exercised one, and a replay route that only runs on a bad network is a replay
 * route nobody has tested. The drain immediately afterwards is what makes the
 * connected case feel immediate.
 *
 * `bulletin.create` is the mutation type with a real handler behind
 * `sync.submitMutations`, so a duplicate submission of the same envelope comes back
 * `replayed` and produces exactly one bulletin.
 */
export function ComposeBulletinRoute(): JSX.Element {
  const navigate = useNavigate();
  const { database, syncRunner } = useOffline();
  const [type, setType] = useState<BulletinType>(BULLETIN_TYPE.request);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSubmitting(true);

    // The payload is written once and never touched again: the server hashes it to
    // decide replay-versus-duplicate, so normalising it later would break idempotency.
    await queueMutation(database, {
      mutationType: 'bulletin.create',
      payload: { type, title, body },
    });

    await syncRunner.drain();
    await navigate('/board');
  }

  return (
    <section className="screen" data-testid="compose-bulletin">
      <h1 className="screen__title">Post a bulletin</h1>

      <form
        className="form"
        onSubmit={(event) => {
          void onSubmit(event);
        }}
      >
        <label className="form__field">
          <span className="form__label">Type</span>
          <select
            className="form__input"
            data-testid="compose-bulletin-type-select"
            aria-label="Type"
            name="type"
            value={type}
            onChange={(event) => setType(event.target.value as BulletinType)}
          >
            {BULLETIN_TYPES.map((candidate) => (
              <option key={candidate} value={candidate}>
                {candidate}
              </option>
            ))}
          </select>
        </label>

        <label className="form__field">
          <span className="form__label">Title</span>
          <input
            className="form__input"
            data-testid="compose-bulletin-title-input"
            name="title"
            required
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>

        <label className="form__field">
          <span className="form__label">Body</span>
          <textarea
            className="form__input form__input--multiline"
            data-testid="compose-bulletin-body-input"
            name="body"
            required
            rows={5}
            value={body}
            onChange={(event) => setBody(event.target.value)}
          />
        </label>

        <button
          className="button button--primary"
          data-testid="compose-bulletin-submit-button"
          type="submit"
          disabled={submitting}
        >
          Post it
        </button>
      </form>
    </section>
  );
}
