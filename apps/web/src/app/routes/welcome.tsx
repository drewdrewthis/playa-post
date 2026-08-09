import { useState, type JSX } from 'react';
import { useNavigate } from 'react-router';

import { markWelcomeSeen, WELCOME_STEPS } from '../welcome/welcome-steps';

import '../welcome/welcome.css';

/**
 * `/welcome` — the comp's onboarding takeover, as a route: three product steps from
 * the comp, then the principles intro (see `welcome-steps.ts` for that extension).
 *
 * The comp draws it as an overlay the app shows when `playapost-onboarded` is unset;
 * here it is where an anonymous first visit lands (`RequireSession` sends a signed-out
 * visitor who has never seen it here instead of `/signin`), and a signed-in user
 * replays it from the You screen. Both exits — Skip and Get started — mark it seen and
 * drop to `/signin`, which bounces a signed-in replayer straight home.
 *
 * Deliberately public and network-free: it is a pitch to somebody who may not have an
 * account, so nothing here may require one.
 */
export function WelcomeRoute(): JSX.Element {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);

  const current = WELCOME_STEPS[step];
  const lastStep = step === WELCOME_STEPS.length - 1;

  function finish(): void {
    markWelcomeSeen();
    void navigate('/signin');
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
        <div className="screen screen--fill welcome">
          <button className="welcome__skip" type="button" onClick={finish}>
            Skip
          </button>

          <span className="welcome__icon" aria-hidden="true">
            {current.icon}
          </span>
          <h1 className="welcome__title">{current.title}</h1>
          <p className="welcome__body">{current.body}</p>
          {current.code === null ? null : <code className="welcome__code">{current.code}</code>}
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
