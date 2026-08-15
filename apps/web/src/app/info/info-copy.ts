import { WELCOME_STEPS } from '../welcome/welcome-steps';

/**
 * The Info screen's copy and links (issue #216).
 *
 * The pitch and the values line are **read out of `WELCOME_STEPS`, not retyped**: the
 * welcome carousel is where the owner's wording lives and where the snapshot tests pin
 * it, so a second copy here would be the copy that drifts. The first step is the pitch
 * and the last is the values close by the carousel's own design (#214) — if that shape
 * ever changes, `info-copy.unit.test.ts` fails loudly rather than this screen quietly
 * showing the wrong sentence.
 */
const firstStep = WELCOME_STEPS[0];
const lastStep = WELCOME_STEPS.at(-1);

if (firstStep === undefined || lastStep === undefined) {
  throw new Error('WELCOME_STEPS is empty; the Info screen has no pitch to show');
}

/** "Your social network is like your extended family…" — the what-and-why. */
export const INFO_PITCH = firstStep.body;

/** "Privacy first, always free, always open-source…" — the values close. */
export const INFO_VALUES = lastStep.body;

/** The open-source home. The values line above promises "always open-source"; this is the receipt. */
export const GITHUB_REPO_URL = 'https://github.com/drewdrewthis/playa-post';

/**
 * Support link — a plain anchor, deliberately **not** Buy Me a Coffee's embed widget.
 * The widget is a third-party `<script>` off `cdnjs.buymeacoffee.com`: a tracker on an
 * app whose pitch is "no ads, no noise", a fetch the service worker cannot cache, and
 * a hole in any CSP this app ever adopts. The link opens the same page.
 */
export const BUY_ME_A_COFFEE_URL = 'https://buymeacoffee.com/playapost';

export const BUY_ME_A_COFFEE_LABEL = '☕ Buy me a coffee';
