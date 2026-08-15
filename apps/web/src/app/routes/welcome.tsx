import { useRef, useState, type JSX, type PointerEvent as ReactPointerEvent } from 'react';
import { useLocation, useNavigate } from 'react-router';

import { markWelcomeSeen, WELCOME_STEPS } from '../welcome/welcome-steps';

import '../welcome/welcome.css';

/**
 * How far a horizontal drag must travel, in px, to count as a swipe rather than a
 * wobbly tap, and how dominant it must be over the vertical axis so a scroll through
 * the roll-call never turns a page.
 */
const SWIPE_DISTANCE_PX = 48;

/**
 * `/welcome` — the comp's onboarding takeover, as a route: four steps (#214 —
 * extended-family intro, the principle roll-call, the offers-and-privacy step,
 * the values close; see `welcome-steps.ts`).
 *
 * The comp draws it as an overlay the app shows when `playapost-onboarded` is unset;
 * here it is where an anonymous first visit lands (`RequireSession` sends a signed-out
 * visitor who has never seen it here instead of `/signin`), and a signed-in user
 * replays it from the You screen. Both exits — Skip and Get started — mark it seen and
 * drop to `/signin`, which bounces a signed-in replayer straight home.
 *
 * Pages turn two ways: the Next pill, and finger swipes in both directions (#214).
 * Swipes are read from pointer events rather than touch events so a mouse drag pages
 * too and Playwright can drive it; `touch-action: pan-y` on the screen leaves vertical
 * scrolling native while handing horizontal gestures to us. A swipe back from the
 * first step and a swipe forward from the last both stay put — only the button exits.
 *
 * Deliberately public and network-free: it is a pitch to somebody who may not have an
 * account, so nothing here may require one.
 */
export function WelcomeRoute(): JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const [step, setStep] = useState(0);
  const pointerStart = useRef<{ x: number; y: number } | null>(null);

  const current = WELCOME_STEPS[step];
  const lastStep = step === WELCOME_STEPS.length - 1;

  function finish(): void {
    markWelcomeSeen();
    // Forwarded untouched: a first-ever visit that arrived through an invite link
    // carries that address as state (#205), and sign-in is where it gets honoured.
    void navigate('/signin', { state: location.state });
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
    pointerStart.current = { x: event.clientX, y: event.clientY };
    // Capture, so a drag released outside the screen still delivers pointerup
    // here — but not for presses on Next/Skip: capture retargets the eventual
    // click at this div, which would swallow the buttons.
    if (!(event.target instanceof Element) || event.target.closest('button') === null) {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  }

  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>): void {
    const start = pointerStart.current;
    pointerStart.current = null;
    if (start === null) {
      return;
    }
    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;
    if (Math.abs(deltaX) < SWIPE_DISTANCE_PX || Math.abs(deltaX) <= Math.abs(deltaY)) {
      return;
    }
    if (deltaX < 0 && !lastStep) {
      setStep(step + 1);
    } else if (deltaX > 0 && step > 0) {
      setStep(step - 1);
    }
  }

  if (current === undefined) {
    // Unreachable (`WELCOME_STEPS` is non-empty); typed for `noUncheckedIndexedAccess`.
    return <></>;
  }

  return (
    <div className="app-frame">
      <main className="app-column" data-testid="welcome">
        {/* Not `screen--centred`: its plain `center` lands later in the cascade and
            would override the `safe center` that keeps the tall roll-call scrollable. */}
        <div
          className="screen screen--fill welcome"
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onPointerCancel={() => {
            pointerStart.current = null;
          }}
          onLostPointerCapture={() => {
            pointerStart.current = null;
          }}
        >
          <button className="welcome__skip" type="button" onClick={finish}>
            Skip
          </button>

          <span className="welcome__icon" aria-hidden="true">
            {current.icon}
          </span>
          <h1 className="welcome__title">{current.title}</h1>
          <p className="welcome__body">{current.body}</p>
          {current.principles === null ? null : (
            <dl className="welcome__principles">
              {current.principles.map(({ name, gloss }, index, all) => (
                // The +1 — Consent — is marked here rather than matched with a
                // `:last-child` rule, so the stylesheet styles the extra principle
                // instead of whichever one happens to be eleventh.
                <div
                  key={name}
                  className={
                    index === all.length - 1
                      ? 'welcome__principle welcome__principle--plus-one'
                      : 'welcome__principle'
                  }
                  data-testid="welcome-principle"
                >
                  <dt className="welcome__principle-name">{name}</dt>
                  <dd className="welcome__principle-gloss">{gloss}</dd>
                </div>
              ))}
            </dl>
          )}

          <div className="welcome__dots" aria-hidden="true">
            {WELCOME_STEPS.map((welcomeStep, index) => (
              <span
                key={welcomeStep.title}
                className={index === step ? 'welcome__dot welcome__dot--active' : 'welcome__dot'}
              />
            ))}
          </div>

          <button
            className="button button--primary welcome__next"
            data-testid="welcome-next"
            type="button"
            onClick={() => {
              if (lastStep) {
                finish();
                return;
              }
              setStep(step + 1);
            }}
          >
            {lastStep ? 'Get started' : 'Next'}
          </button>
        </div>
      </main>
    </div>
  );
}
