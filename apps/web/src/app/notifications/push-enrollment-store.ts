/**
 * Where this device last stood on push, remembered locally so the first paint is right.
 *
 * Push enrolment is a **device** fact: a subscription lives in this browser's own service
 * worker registration, and nothing about it is derivable from an account. So the two
 * answers this file keeps are device facts too, and they live beside `playapost-theme`
 * and `playapost-onboarded` in `localStorage` rather than on the server — an
 * account-level record would suppress the offer on a new device where it has never been
 * made (`docs/product/decisions.md` D8).
 *
 * ⚠ **A hint for the first paint, never the authority.** The truth is the subscription
 * the browser is actually holding, which `settlePushEnrollment` reads a tick after mount
 * and reconciles against what is here. Everything in this file exists so that a device
 * which enrolled last week paints "Push is on for this device." immediately instead of
 * flashing the consent copy at somebody who has already consented. Nothing here may be
 * *believed* over the browser: a marker that disagrees is corrected, never obeyed.
 */

/** The two facts this device remembers, as the flow reads them. */
export interface PushEnrollmentMarker {
  /**
   * The VAPID public key this device last enrolled under, or `null`.
   *
   * The key rather than a boolean, because a subscription is bound for life to the key
   * that minted it: after the rotation `docs/engineering/secrets.md` §4 prescribes, a
   * device "subscribed" under the superseded key is not subscribed at all, and a boolean
   * could not tell the two apart.
   */
  readonly subscribedKey: string | null;

  /**
   * When the browser's own permission prompt was last dismissed without an answer, or
   * `null`. Read against a cooldown in `enable-push.ts` — the record is a timestamp, not
   * a flag, precisely so the offer can come back.
   */
  readonly dismissedAt: Date | null;
}

/**
 * The device-local marker, as a port.
 *
 * A port rather than four direct `localStorage` calls, for the reason `PushBrowser` is
 * one: the rules that read a marker have to be reachable from a test that hands one in,
 * and the `unit` project runs in Node, where there is no Web Storage global to write to
 * at all. {@link deviceLocalPushEnrollmentStore} is the only implementation that touches
 * one.
 */
export interface PushEnrollmentStore {
  /** This device's marker. Never throws — unreadable storage reads as an empty one. */
  read(): PushEnrollmentMarker;

  /**
   * Record an enrolment under `applicationServerKey`.
   *
   * ⚠ **Clears any recorded dismissal**, because the two answer the same question and a
   * device may never hold both. Left behind, a "not now" from before an enrolment would
   * silence the offer after a later permission revoke — a device with push switched off
   * at the OS level and nothing in the app admitting it.
   */
  rememberSubscribed(applicationServerKey: string): void;

  /** Record that the browser's prompt was dismissed, now. */
  rememberPromptDismissed(): void;

  /** Forget the enrolment alone: a revoked permission, or a subscription that is gone. */
  forgetSubscribed(): void;
}

/**
 * The key holding what this device enrolled under.
 *
 * Namespaced like `playapost-theme` and `playapost-onboarded`, and separate from the
 * dismissal below rather than one JSON record: two plain strings need no parse step and
 * cannot be half-written.
 */
export const PUSH_SUBSCRIBED_KEY_STORAGE_KEY = 'playapost-push-subscribed-key';

/** The key holding when the browser's prompt was last dismissed, as an ISO timestamp. */
export const PUSH_PROMPT_DISMISSED_STORAGE_KEY = 'playapost-push-dismissed-at';

/**
 * A stored timestamp, or `null` for anything that is not one.
 *
 * Garbage reads as no dismissal, which offers push. The opposite default would let one
 * unparseable string retire the offer on that device for good.
 */
function readTimestamp(raw: string | null): Date | null {
  if (raw === null) {
    return null;
  }

  const parsed = new Date(raw);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** The real storage. Every access is guarded — see the `catch` bodies for what that buys. */
export function deviceLocalPushEnrollmentStore(): PushEnrollmentStore {
  return {
    read() {
      try {
        return {
          subscribedKey: globalThis.localStorage.getItem(PUSH_SUBSCRIBED_KEY_STORAGE_KEY),
          dismissedAt: readTimestamp(
            globalThis.localStorage.getItem(PUSH_PROMPT_DISMISSED_STORAGE_KEY),
          ),
        };
      } catch {
        // A locked-down profile throws on access. An empty marker costs one flash of the
        // consent copy before the settle answers; a throw costs the notifications panel.
        return { subscribedKey: null, dismissedAt: null };
      }
    },

    rememberSubscribed(applicationServerKey: string) {
      try {
        globalThis.localStorage.setItem(PUSH_SUBSCRIBED_KEY_STORAGE_KEY, applicationServerKey);
        globalThis.localStorage.removeItem(PUSH_PROMPT_DISMISSED_STORAGE_KEY);
      } catch {
        // Not remembered across reloads. The subscription itself is unaffected, so the
        // settle still finds it — this device just pays a flash on each first paint.
      }
    },

    rememberPromptDismissed() {
      try {
        globalThis.localStorage.setItem(
          PUSH_PROMPT_DISMISSED_STORAGE_KEY,
          new Date().toISOString(),
        );
      } catch {
        // The next load offers push again, which is the pre-#167 behaviour: survivable.
      }
    },

    forgetSubscribed() {
      try {
        globalThis.localStorage.removeItem(PUSH_SUBSCRIBED_KEY_STORAGE_KEY);
      } catch {
        // Nothing to undo: a marker that cannot be written cannot have been read either.
      }
    },
  };
}
