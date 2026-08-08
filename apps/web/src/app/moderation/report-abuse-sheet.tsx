import { useEffect, useId, useRef, useState, type JSX } from 'react';

import type { ReportBulletinRequest } from '@playa-post/contracts';

import {
  buildReportPayload,
  emptyReportAbuseDraft,
  REPORT_DETAIL_MAX_LENGTH,
  REPORT_REASON_CHOICES,
  reportDraftIssue,
  type ReportAbuseDraft,
  type ReportDraftIssue,
} from './report-abuse-draft';

import './report-abuse-sheet.css';

/** What to say about the one thing still missing. `null` when nothing is. */
function issueHint(issue: ReportDraftIssue | null): string | null {
  switch (issue) {
    case null:
      return null;
    case 'no-reason':
      return 'Choose what kind of abuse this is.';
    case 'no-detail':
      return 'Tell the stewards what happened.';
    case 'too-long':
      return `That is longer than ${String(REPORT_DETAIL_MAX_LENGTH)} characters.`;
  }
}

/**
 * The report-abuse sheet — `design/Playa Post.dc.html:337-356`.
 *
 * Reporting is the one moderation act that makes a claim about somebody, so the sheet
 * asks for the claim: which of five kinds, and what actually happened. Both are
 * required, which is the comp's own rule (`:848` returns early without either), and
 * both reach `moderation.report`.
 *
 * **The blurb is load-bearing copy, not decoration.** It draws the line between report
 * and dismiss — "not a post you disagree with (dismiss those instead)" — and it is the
 * only place the product tells a reporter that the poster never learns who reported.
 * That second sentence is a promise the server keeps (M2-AC10, B9); do not soften it
 * here without changing what the server does.
 *
 * Four ways out, matching `bulletin-detail-sheet.tsx`: the CLOSE control, Escape, the
 * scrim, and sending. There is no drag-to-dismiss: this sheet holds typed text, and a
 * downward swipe on a phone is how someone scrolls a textarea.
 */
export function ReportAbuseSheet({
  bulletinId,
  bulletinTitle,
  onClose,
  onSend,
}: {
  readonly bulletinId: string;
  readonly bulletinTitle: string;
  readonly onClose: () => void;
  /** Given the whole request, ready to send. The sheet builds it; the caller sends it. */
  readonly onSend: (report: ReportBulletinRequest) => void;
}): JSX.Element {
  const titleId = useId();
  const reasonsId = useId();
  const hintId = useId();
  const sheetRef = useRef<HTMLElement>(null);
  const [draft, setDraft] = useState<ReportAbuseDraft>(emptyReportAbuseDraft);

  const issue = reportDraftIssue(draft);
  const hint = issueHint(issue);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        onClose();
      }
    }

    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  // Focus moves in on open, so Escape reaches the handler above rather than the detail
  // sheet underneath — which has its own, and would close the wrong thing.
  useEffect(() => {
    sheetRef.current?.focus();
  }, []);

  function send(): void {
    if (issue !== null) {
      return;
    }

    // Built here rather than in the handler: `buildReportPayload` throws on an
    // unsendable draft, and the guard above is what makes that unreachable.
    onSend(buildReportPayload(bulletinId, draft));
  }

  return (
    <>
      {/* Decorative — CLOSE and Escape both do the same thing, and are announced. */}
      <div
        className="report-sheet__scrim"
        aria-hidden="true"
        onClick={() => {
          onClose();
        }}
      />

      <section
        className="report-sheet"
        data-testid="report-abuse-sheet"
        ref={sheetRef}
        /* `role="dialog"` without `aria-modal`, for the reason `bulletin-detail-sheet.tsx`
           records: nothing behind this is `inert`, and claiming modality would describe a
           trap that does not exist. */
        role="dialog"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="report-sheet__header">
          <h2 className="report-sheet__title" id={titleId}>
            Report abuse
          </h2>

          <button
            className="report-sheet__close"
            data-testid="report-abuse-close-button"
            type="button"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        {/* The comp quotes the bulletin so a reporter can see what they are reporting. */}
        <p className="report-sheet__subject">&ldquo;{bulletinTitle}&rdquo;</p>

        <p className="report-sheet__blurb">
          Abuse means harming or deceiving people — not a post you disagree with (dismiss
          those instead). Your report goes to the stewards, who review it and can remove
          the post or the person. The poster never learns who reported.
        </p>

        <div className="report-sheet__reasons">
          <p className="report-sheet__label" id={reasonsId}>
            What kind
          </p>

          <div className="report-sheet__chips" role="group" aria-labelledby={reasonsId}>
            {REPORT_REASON_CHOICES.map((choice) => (
              <button
                key={choice.reason}
                className="report-sheet__chip"
                data-testid={`report-reason-${choice.reason}`}
                type="button"
                /* The one source of truth for "chosen", exactly as the board's filter
                   chips do it: a chip cannot look selected while announcing it is not. */
                aria-pressed={draft.reason === choice.reason}
                onClick={() => {
                  setDraft((previous) => ({ ...previous, reason: choice.reason }));
                }}
              >
                {choice.label}
              </button>
            ))}
          </div>
        </div>

        <label className="report-sheet__field">
          <span className="report-sheet__label">What happened</span>
          <textarea
            className="form__input form__input--prose report-sheet__detail"
            data-testid="report-detail-input"
            rows={3}
            /* No hard `maxLength`: truncating mid-sentence loses what someone wrote.
               The counter and the hint say it instead, and the server refuses it. */
            value={draft.detail}
            placeholder="What happened? Stewards read every word — be specific."
            onChange={(event) => {
              setDraft((previous) => ({ ...previous, detail: event.target.value }));
            }}
          />
        </label>

        {/*
         * ⚠ `aria-disabled`, deliberately, rather than `disabled`. The comp dims this
         * control to .45 and lets `sendReport` silently return — a button that does
         * nothing and says nothing. A real `disabled` attribute is the other extreme:
         * the button leaves the tab order, so a screen-reader user tabs past the thing
         * they came to press and never hears why. `aria-disabled` keeps it focusable and
         * announced, `aria-describedby` gives it the reason, and `send()` guards the
         * click — the comp's intent, made answerable.
         */}
        <button
          className="button button--primary report-sheet__send"
          data-testid="report-send-button"
          type="button"
          aria-disabled={issue !== null}
          aria-describedby={hint === null ? undefined : hintId}
          onClick={send}
        >
          Send to the stewards
        </button>

        {hint === null ? (
          <p className="report-sheet__counter">
            {draft.detail.trim().length}/{REPORT_DETAIL_MAX_LENGTH}
          </p>
        ) : (
          <p className="report-sheet__hint" id={hintId}>
            {hint}
          </p>
        )}
      </section>
    </>
  );
}
