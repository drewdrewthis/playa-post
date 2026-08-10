import type { JSX, ReactNode } from 'react';

/**
 * The standalone frame the two failure screens share (issue #125): a title, a line of
 * prose, and whatever way out the screen offers.
 *
 * Deliberately *not* in the shell. Every product screen renders inside `AppShell`, but
 * these two answer for a URL that may match nothing and for a throw that may have come
 * from the shell itself — chrome that offers a tab bar to a broken app is chrome that
 * can break again on the way to explaining the first break.
 */
export function RouteMessageScreen({
  testId,
  title,
  body,
  children,
}: {
  readonly testId: string;
  readonly title: string;
  readonly body: string;
  readonly children?: ReactNode;
}): JSX.Element {
  return (
    <div className="app-frame">
      <main className="app-column" data-testid={testId}>
        <div className="screen screen--fill screen--centred">
          <h1 className="screen__title">{title}</h1>
          <p className="screen__lede">{body}</p>
          {children}
        </div>
      </main>
    </div>
  );
}
