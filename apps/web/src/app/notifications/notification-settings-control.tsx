import { useState, type JSX } from 'react';

import type { NotificationKind } from '@playa-post/contracts';

import { useNotificationSettings } from './notification-settings';

/**
 * What each switch is called, and what turning it off means — said in the label, not in
 * a tooltip nobody on a phone will ever see.
 *
 * ⚠ Keyed by the contract's `NotificationKind`, so a kind added there without a line
 * here is a compile error rather than a switch labelled `undefined`.
 */
const KIND_COPY: Record<NotificationKind, { readonly label: string; readonly detail: string }> = {
  bulletins: {
    label: 'Bulletins',
    detail: 'When something lands on your board.',
  },
  note: {
    label: 'Notes',
    detail: 'When somebody pins a note to your board.',
  },
  connections: {
    label: 'Connection requests',
    detail: 'When somebody asks to connect with you.',
  },
};

/**
 * The panel's per-kind switches, behind a disclosure toggle (issue #209).
 *
 * **A toggle, not a page**: two switches do not justify a route, and the panel is where
 * the intent already is — the same argument that put `EnablePushControl` here. Collapsed
 * by default, because the switches are for the rare visit that wants to change
 * something, and every other visit came to read.
 *
 * **Each switch is a real `role="switch"` button** — `aria-checked` carries the state,
 * so what a screen reader announces is exactly what the server holds, optimism
 * included. Off is the marked state visually and textually ("Off" beside the switch)
 * rather than by colour alone.
 *
 * These switches govern **what gets delivered at all** — matching and receipts on the
 * server (ADR-0020) — where `EnablePushControl` above governs whether *this device*
 * gets pinged. Orthogonal, and both live here because both answer "why is my phone
 * (not) buzzing".
 */
export function NotificationSettingsControl(): JSX.Element {
  const [open, setOpen] = useState(false);
  const { settings, loading, setEnabled } = useNotificationSettings(open);

  return (
    <section className="notifications__settings" data-testid="notification-settings">
      <button
        className="notifications__settings-toggle"
        data-testid="notification-settings-toggle"
        type="button"
        aria-expanded={open}
        onClick={() => {
          setOpen((current) => !current);
        }}
      >
        <span aria-hidden="true">⚙</span> Notification settings
      </button>

      {!open ? null : loading ? (
        <p className="notifications__settings-loading" data-testid="notification-settings-loading">
          Loading your settings…
        </p>
      ) : settings === null ? (
        // The read failed. One honest line, and the toggle still closes and reopens to
        // retry — the same "no cause offered" stance as the push control's failure copy.
        <p className="notifications__settings-loading" role="status">
          Your settings did not load. Close and reopen to try again.
        </p>
      ) : (
        <ul className="notifications__settings-list">
          {settings.settings.map((setting) => {
            const copy = KIND_COPY[setting.kind];

            return (
              <li className="notification-setting" key={setting.kind}>
                <span className="notification-setting__copy">
                  <span className="notification-setting__label" id={`setting-${setting.kind}`}>
                    {copy.label}
                  </span>
                  <span className="notification-setting__detail">{copy.detail}</span>
                </span>

                <button
                  className="notification-setting__switch"
                  data-testid={`notification-setting-${setting.kind}`}
                  type="button"
                  role="switch"
                  aria-checked={setting.enabled}
                  aria-labelledby={`setting-${setting.kind}`}
                  onClick={() => {
                    setEnabled(setting.kind, !setting.enabled);
                  }}
                >
                  <span className="notification-setting__state">
                    {setting.enabled ? 'On' : 'Off'}
                  </span>
                  <span className="notification-setting__track" aria-hidden="true">
                    <span className="notification-setting__thumb" />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
