/**
 * The three self-hosted typefaces, loaded as a side effect.
 *
 * Self-hosted rather than a Google Fonts `<link>` because the product must work offline
 * (addendum §14): a font served from `fonts.gstatic.com` is a font a user on playa does
 * not have. These files are emitted into the build and precached by the service worker
 * (`vite.config.ts`'s workbox `globPatterns` includes `woff2`).
 *
 * ⚠ **Latin subset only, and only the weights the design uses.** Every `.woff2` this
 * module reaches gets precached on install, so importing `@fontsource/karla/400.css`
 * (all subsets) instead of `latin-400.css` would put Cyrillic and Vietnamese glyph sets
 * nobody reads into every installation. Adding a weight here is adding a download —
 * check the design comp actually uses it first.
 *
 * The set is: Instrument Serif 400 upright + italic (wordmark, headings, card titles),
 * Karla 400/500/600/700 (labels, controls, chips, body), IBM Plex Mono 400/500/600
 * (query text and codes).
 */

import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import '@fontsource/ibm-plex-mono/latin-600.css';
import '@fontsource/instrument-serif/latin-400-italic.css';
import '@fontsource/instrument-serif/latin-400.css';
import '@fontsource/karla/latin-400.css';
import '@fontsource/karla/latin-500.css';
import '@fontsource/karla/latin-600.css';
import '@fontsource/karla/latin-700.css';
