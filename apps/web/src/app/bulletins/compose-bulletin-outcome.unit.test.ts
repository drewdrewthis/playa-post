import { describe, expect, it } from 'vitest';

import { describeSubmissionOutcome } from './compose-bulletin-outcome';

describe('describeSubmissionOutcome', () => {
  it('reports a synced row as posted', () => {
    expect(describeSubmissionOutcome('synced', null)).toEqual({
      kind: 'posted',
      message: 'Posted — it’s on your board.',
    });
  });

  it('reports a still-pending row as queued, in the comp’s words', () => {
    expect(describeSubmissionOutcome('pending', null)).toEqual({
      kind: 'queued',
      message: 'Queued — will sync when you’re back.',
    });
  });

  it('reports an in-flight row as queued rather than as posted', () => {
    const outcome = describeSubmissionOutcome('inflight', null);

    expect(outcome.kind).toBe('queued');
    expect(outcome.message).not.toContain('Posted');
  });

  it('leaves a pending row queued even when a transport error was recorded', () => {
    expect(describeSubmissionOutcome('pending', 'TRANSPORT_UNAVAILABLE').kind).toBe('queued');
  });

  it('names the refused expiry in words, for the server’s expiry code', () => {
    expect(describeSubmissionOutcome('failed', 'BULLETIN_EXPIRY_INVALID')).toEqual({
      kind: 'refused',
      message: 'That expiry has already passed. Pick another and post again.',
    });
  });

  it('names the refused content in words, for the server’s content code', () => {
    expect(describeSubmissionOutcome('failed', 'BULLETIN_CONTENT_INVALID')).toEqual({
      kind: 'refused',
      message:
        'The server refused this bulletin’s title, body, or location. Shorten it and post again.',
    });
  });

  it('shows an unrecognized server code verbatim rather than inventing a message for it', () => {
    const outcome = describeSubmissionOutcome('failed', 'FORBIDDEN');

    expect(outcome.kind).toBe('refused');
    expect(outcome.message).toContain('FORBIDDEN');
  });

  it('still refuses when the server gave no code at all', () => {
    const outcome = describeSubmissionOutcome('failed', null);

    expect(outcome.kind).toBe('refused');
    expect(outcome.message).toBe('The server refused this bulletin.');
  });

  it('treats a conflicted row as a refusal, never as a quiet success', () => {
    const outcome = describeSubmissionOutcome('conflicted', 'VERSION_CONFLICT');

    expect(outcome.kind).toBe('refused');
    expect(outcome.message).toContain('VERSION_CONFLICT');
  });
});
