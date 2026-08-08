/**
 * The pan-and-zoom arithmetic behind the graph canvas.
 *
 * The comp drives its network with pointer handlers and a CSS transform on a wrapper
 * div (`gDown`/`gMove`/`gUp`/`gWheel`, `clampZ`, `zoomBy`). The same four moves live
 * here as pure functions over a plain `Viewport`, so the maths can be proven without a
 * browser and the component is left holding nothing but event wiring.
 *
 * Every number is in **canvas units** — the same units the SVG `viewBox` is expressed
 * in, not pixels. {@link viewBoxUnitsPerPixel} is the one conversion, and it is the only
 * function here that has to know how big the element ended up on screen.
 */

/** A point on the canvas. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/** Anything with a width and a height: an element's box, or a `viewBox`. */
export interface Size {
  readonly width: number;
  readonly height: number;
}

/** How the canvas is currently framed: a scale, and where the origin has been dragged to. */
export interface Viewport {
  readonly scale: number;
  readonly x: number;
  readonly y: number;
}

/** The comp's `clampZ` bounds. Below the floor the picture is unreadable; above the ceiling it is a blur. */
export const MINIMUM_SCALE = 0.35;
export const MAXIMUM_SCALE = 2.5;

/** One press of `+` or `−`, the comp's `zoomIn`/`zoomOut` step. */
export const BUTTON_ZOOM_FACTOR = 1.3;

/** One notch of the wheel, the comp's `gWheel` step. */
export const WHEEL_ZOOM_FACTOR = 1.12;

/**
 * How far a pointer may travel before the press stops counting as a tap.
 *
 * ⚠ Without this a pan that happens to start on a node ends by opening that person —
 * the user dragged the canvas and got a navigation. The comp's `_sup` flag exists for
 * exactly this and uses exactly this distance.
 */
export const DRAG_CLICK_SUPPRESSION_PX = 8;

/**
 * The whole picture, unzoomed and undragged.
 *
 * This is also "fit": the layout's bounds *are* the `viewBox`, so an untransformed
 * canvas already frames every node — the comp needs a hand-tuned `zoomFit` only because
 * its canvas is a fixed 1200x1200 regardless of what is on it.
 */
export const FITTED_VIEWPORT: Viewport = { scale: 1, x: 0, y: 0 };

/** Hold a scale inside the readable range. */
export function clampScale(scale: number): number {
  return Math.min(MAXIMUM_SCALE, Math.max(MINIMUM_SCALE, scale));
}

/**
 * Scale the canvas about a fixed point.
 *
 * The point under `focus` stays under `focus`, which is what makes zooming feel like
 * moving closer rather than like the picture sliding away. At the clamp the factor
 * collapses to 1 and the framing is left exactly as it was — a zoom that cannot zoom
 * must not pan.
 */
export function zoomViewport(viewport: Viewport, factor: number, focus: Point): Viewport {
  const scale = clampScale(viewport.scale * factor);
  const applied = scale / viewport.scale;

  return {
    scale,
    x: focus.x - applied * (focus.x - viewport.x),
    y: focus.y - applied * (focus.y - viewport.y),
  };
}

/** Drag the canvas by a distance already expressed in canvas units. */
export function panViewport(viewport: Viewport, dx: number, dy: number): Viewport {
  return { scale: viewport.scale, x: viewport.x + dx, y: viewport.y + dy };
}

/**
 * How many canvas units one screen pixel covers, for an SVG fitted with
 * `preserveAspectRatio="xMidYMid meet"`.
 *
 * ⚠ `meet` fits the *smaller* of the two ratios, so the conversion is that same
 * minimum. Using the width ratio alone makes a drag on a short, wide canvas move the
 * picture faster than the finger.
 *
 * A degenerate box — an element not laid out yet, an empty graph — reports 1 rather
 * than dividing by zero: dragging at the wrong rate is recoverable, `NaN` coordinates
 * are not.
 */
export function viewBoxUnitsPerPixel(element: Size, viewBox: Size): number {
  if (
    element.width <= 0 ||
    element.height <= 0 ||
    viewBox.width <= 0 ||
    viewBox.height <= 0
  ) {
    return 1;
  }

  return 1 / Math.min(element.width / viewBox.width, element.height / viewBox.height);
}

/** Whether a press that moved this far should be treated as a drag rather than a tap. */
export function dragSuppressesClick(movement: number): boolean {
  return movement > DRAG_CLICK_SUPPRESSION_PX;
}
