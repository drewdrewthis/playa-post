# ADR-0015 — Two token sets, an explicit theme toggle, and self-hosted type

- **Status:** proposed
- **Date:** 2026-08-07
- **Drivers:** addendum §14 (offline), §18 (proven libraries), §24 (simplest proven
  implementation); `design/Playa Post.dc.html`; issues #43, #51, #52, #151

## Context

M2 shipped the frontend with one hard-pinned light palette, a `color-scheme: light`
declaration, and no webfonts — a deliberate narrowing recorded in `tokens.css` itself
("Light theme only… a half-built dark theme is worse than none"). The design-conformance
wave lifts that narrowing, and doing so forces three choices that outlive the wave.

The settled UX prototype (`design/Playa Post.dc.html`) is product evidence, not
production code: it carries a `theme(dark)` function returning ~35 named values per
theme, three Google-hosted typefaces, and a toggle that writes
`localStorage['playapost-theme']`. It is the source of truth for *what the product looks
like*, and says nothing about how a React app should be built.

Two constraints press on the answer. The product must work offline (§14) — this is a
network for a place with no connectivity, and "the app renders in Times New Roman when
you arrive" is a real failure. And a theme is chosen before React mounts or it flashes:
a preference read during render resolves one frame after the browser has already painted
the other palette.

## Decision

**1. Two complete token sets, selected by a `data-theme` attribute.**

`app/theme/tokens.css` declares the light set on `:root` and the dark set on
`[data-theme='dark']`, with every value copied verbatim from the prototype's `theme()`
function. Semantic names (`--pp-card`, `--pp-tab-on`, `--pp-fab-bg`), never literal ones
— a rule that says `background: var(--pp-card)` is theme-agnostic by construction, and
is the only way a second palette does not mean a second stylesheet.

`color-scheme` is declared *per theme* rather than pinned, so the caret, scrollbars, and
native controls follow the choice.

⚠ Two tokens are **images**, not colours, in dark: `--pp-bg` (a radial gradient) and
`--pp-fab-bg` (a linear gradient). They must be applied with the `background` shorthand;
`background-color:` silently renders nothing.

**2. An explicit persisted preference — light, dark, or system.**

The choice lives in `localStorage['playapost-theme']` as one of `'light' | 'dark' |
'system'`, cycled by a button in the chrome. This mirrors the prototype's own toggle
mechanism, and defaulting to something fixed rather than a bare OS reading is still right
on its own terms: an OS preference set at a desk months earlier is a poor guess about a
person standing in a dust storm at 3am — which is why `'system'` is a preference someone
opts into here, not the fallback.

The default is **dark** (issue #151, amending this decision — superseding issue #43's
original light default). Nothing stored, or a stored value that is not one of the three,
resolves to dark outright; it is not `'system'`-resolved, because a first-run default is
itself a product choice and this one is dark regardless of the device it lands on.
`'system'` itself resolves live via `matchMedia('(prefers-color-scheme: dark)')`, with a
change listener kept while it is the active preference; `'light'` and `'dark'` stay
pinned regardless of what the OS reports.

**First paint is handled by an inline, render-blocking script in `index.html`** that
stamps `data-theme` before the body renders. `ThemeProvider` owns every change after
mount. The storage key and the two `theme-color` values are therefore duplicated between
`index.html` and `app/theme/theme-preference.ts`. That duplication is the decision, not
an oversight — a module import cannot run before paint, and the alternative is a
guaranteed light flash on every load for every dark-theme user. Both copies carry a
comment naming the other.

**3. Typefaces are self-hosted, latin-subset, design-weights-only.**

`@fontsource/instrument-serif`, `@fontsource/karla`, and `@fontsource/ibm-plex-mono`, all
pinned exact, imported from `app/theme/typefaces.ts`. Not a `fonts.googleapis.com` link:
a font served from a CDN is a font a user on playa does not have, and §14 makes that a
correctness question rather than a performance one.

The import list is a **precache budget**, because `vite.config.ts`'s workbox
`globPatterns` precaches every emitted `.woff2`. Importing `@fontsource/karla/400.css`
instead of `latin-400.css` would ship Cyrillic and Vietnamese glyph sets to every
installation. Nine files, ~140 KB of `woff2`, are what the design actually uses.

## Alternatives considered

- **`prefers-color-scheme` with no toggle.** Half the work and no persisted state, but it
  cannot express "dark right now on a light-mode phone", which is the case the product
  exists for. Rejected.
- **A `<html class="dark">` class instead of a data attribute.** Equivalent in every way
  that matters; `data-theme` was chosen because it holds a *value* rather than encoding
  one state as presence, so a third theme is a new value and not a new class.
- **Accepting the first-paint flash** and dropping the inline script. This was tempting —
  it removes the only duplicated constant in the frontend. Rejected because the flash is
  on every load, for every dark user, forever, and the duplication is two lines guarded
  by comments on both sides.
- **A CSS-in-JS or design-token build step** (Style Dictionary, vanilla-extract, Tailwind
  themes). Custom properties are the platform's own token mechanism and cost nothing to
  ship; §18 and §24 both point at the existing proven thing.

## Consequences

- A screen styled with literal colours is now a bug that only shows up in one theme.
  Reviewing new CSS means checking that it names tokens.
- Adding a font weight is adding a download to every installation. The import list in
  `typefaces.ts` is the place that decision gets made and reviewed.
- The prototype's per-bulletin-type tint map (`tintsL`/`tintsD`) is only partly
  transcribed: `--pp-tint-request` exists because `request` is the only member of
  `BULLETIN_TYPE`. Each new type brings its two values with it.
- `playwright.config.ts` stays pinned to `colorScheme: 'light'`. That setting controls the
  *OS* preference, which only the `'system'` preference reads — and the default is dark
  (issue #151), so a plain e2e run now exercises dark by default. The pinned light OS
  value is reached only by cycling the toggle to `'system'`, which suites do explicitly
  where a screen needs both palettes proven (e.g. `you-screen.spec.ts`).

## Verification

Not gated by a fitness function, and deliberately so — the failure modes here are visual,
and a test asserting that `--pp-ink` equals `#2e2418` restates the stylesheet rather than
checking anything. What CI does prove is that the build emits the fonts (`build:web`) and
that no module imports something it should not (`boundaries`). Palette fidelity and the
absence of a first-paint flash are QA-pass observations against
`design/Playa Post.dc.html`.
