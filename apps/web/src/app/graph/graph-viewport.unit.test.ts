import { describe, expect, it } from 'vitest';

import {
  clampScale,
  dragSuppressesClick,
  DRAG_CLICK_SUPPRESSION_PX,
  FITTED_VIEWPORT,
  MAXIMUM_SCALE,
  MINIMUM_SCALE,
  panViewport,
  viewBoxUnitsPerPixel,
  zoomViewport,
  type Point,
  type Viewport,
} from './graph-viewport';

/** Where a canvas point ends up once the viewport has been applied. */
function projected(viewport: Viewport, point: Point): Point {
  return {
    x: viewport.x + viewport.scale * point.x,
    y: viewport.y + viewport.scale * point.y,
  };
}

/** Which canvas point currently sits under a point on screen. */
function under(viewport: Viewport, point: Point): Point {
  return {
    x: (point.x - viewport.x) / viewport.scale,
    y: (point.y - viewport.y) / viewport.scale,
  };
}

describe('clampScale', () => {
  it('holds the scale inside the readable range', () => {
    expect(clampScale(0.01)).toBe(MINIMUM_SCALE);
    expect(clampScale(100)).toBe(MAXIMUM_SCALE);
    expect(clampScale(1.4)).toBe(1.4);
  });
});

describe('zoomViewport', () => {
  it('leaves the point it zoomed about exactly where it was', () => {
    const focus: Point = { x: 120, y: -40 };
    const before = under(FITTED_VIEWPORT, focus);

    const after = under(zoomViewport(FITTED_VIEWPORT, 1.3, focus), focus);

    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it('still holds that point still when zooming out from an already dragged canvas', () => {
    const viewport: Viewport = { scale: 1.6, x: -220, y: 35 };
    const focus: Point = { x: 10, y: 10 };

    const after = under(zoomViewport(viewport, 1 / 1.3, focus), focus);
    const before = under(viewport, focus);

    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it('does not drag the picture once the zoom has nothing left to give', () => {
    const atCeiling: Viewport = { scale: MAXIMUM_SCALE, x: 17, y: -9 };

    expect(zoomViewport(atCeiling, 4, { x: 300, y: 300 })).toEqual(atCeiling);
  });

  it('magnifies what it frames', () => {
    const zoomed = zoomViewport(FITTED_VIEWPORT, 2, { x: 0, y: 0 });

    expect(zoomed.scale).toBe(2);
    expect(projected(zoomed, { x: 50, y: 0 }).x).toBe(100);
  });
});

describe('panViewport', () => {
  it('moves the picture with the finger and leaves the scale alone', () => {
    expect(panViewport({ scale: 1.5, x: 10, y: 20 }, -4, 6)).toEqual({
      scale: 1.5,
      x: 6,
      y: 26,
    });
  });
});

describe('viewBoxUnitsPerPixel', () => {
  it('converts pixels to canvas units for a square canvas', () => {
    expect(viewBoxUnitsPerPixel({ width: 400, height: 400 }, { width: 800, height: 800 })).toBe(2);
  });

  it('follows the axis that "meet" fitted, not the wider one', () => {
    expect(viewBoxUnitsPerPixel({ width: 400, height: 200 }, { width: 800, height: 800 })).toBe(4);
  });

  it('reports a harmless 1 rather than dividing by an unlaid-out box', () => {
    expect(viewBoxUnitsPerPixel({ width: 0, height: 0 }, { width: 800, height: 800 })).toBe(1);
    expect(viewBoxUnitsPerPixel({ width: 400, height: 400 }, { width: 0, height: 0 })).toBe(1);
  });
});

describe('dragSuppressesClick', () => {
  it('lets a still press through as a tap', () => {
    expect(dragSuppressesClick(0)).toBe(false);
    expect(dragSuppressesClick(DRAG_CLICK_SUPPRESSION_PX)).toBe(false);
  });

  it('swallows the tap that ends a drag', () => {
    expect(dragSuppressesClick(DRAG_CLICK_SUPPRESSION_PX + 1)).toBe(true);
  });
});
