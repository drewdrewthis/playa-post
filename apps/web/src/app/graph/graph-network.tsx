import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';

import type { Graph, Person } from '@playa-post/contracts';

import { layoutGraph, type GraphLayoutEdge, type GraphLayoutNode } from './graph-layout';
import { nodeInitial, nodeLabel } from './graph-node-identity';
import {
  BUTTON_ZOOM_FACTOR,
  dragSuppressesClick,
  FITTED_VIEWPORT,
  panViewport,
  viewBoxUnitsPerPixel,
  WHEEL_ZOOM_FACTOR,
  zoomViewport,
} from './graph-viewport';

import './graph-viz.css';

/** The degree the viewer carries on their own graph. */
const VIEWER_DEGREE = 0;

/** Past this degree a node is a shape in a cluster, not somebody you are reading about. */
const LABELLED_DEGREE = 1;

/** How far below a dot its name sits, in canvas units. */
const LABEL_GAP = 15;

/** How far past a dot the "you" halo reaches, as a multiple of the dot's radius. */
const HALO_SPREAD = 1.6;

/** The comp's light-theme "you" treatment: a ring of background, then a ring of ink. */
const INNER_RING_INSET = 2;
const OUTER_RING_INSET = 5;

/** How a person's node was activated. A pan can cancel a `tap`; nothing cancels a `key`. */
type Gesture = 'tap' | 'key';

/** What one press of a pointer is tracking while it is down. */
interface Drag {
  readonly pointerId: number;
  readonly unitsPerPixel: number;
  lastX: number;
  lastY: number;
  movement: number;
}

/**
 * The viewer's network, drawn.
 *
 * The comp's graph screen (`design/Playa Post.dc.html`, lines 49-73) as it survives
 * contact with real data: SVG lines and dots on a canvas the user drags and zooms, the
 * viewer glowing at the centre, their connections ringed around them and clustered by
 * who knows whom. What the comp hand-places, {@link layoutGraph} derives; what the comp
 * fabricates — decoy nodes, edge weights between strangers, a bulletin count per person
 * — has no counterpart here and is simply absent.
 *
 * Everything with arithmetic in it lives in `graph-layout.ts` and `graph-viewport.ts`.
 * What is left here is event wiring and markup, which is the part a browser has to be
 * present to judge.
 */
export function GraphNetwork({
  graph,
  onOpenPerson,
}: {
  readonly graph: Graph;
  readonly onOpenPerson: (person: Person) => void;
}): JSX.Element {
  const layout = useMemo(() => layoutGraph(graph), [graph]);
  const [viewport, setViewport] = useState(FITTED_VIEWPORT);

  const canvasRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const tapSuppressedRef = useRef(false);

  const peopleById = useMemo(
    () => new Map(graph.people.map((person) => [person.userId, person])),
    [graph.people],
  );
  const viewerId = useMemo(
    () => graph.people.find((person) => person.degree === VIEWER_DEGREE)?.userId,
    [graph.people],
  );

  const { bounds } = layout;
  const focusX = bounds.minX + bounds.width / 2;
  const focusY = bounds.minY + bounds.height / 2;

  const zoom = useCallback(
    (factor: number) => {
      setViewport((current) => zoomViewport(current, factor, { x: focusX, y: focusY }));
    },
    [focusX, focusY],
  );

  /*
   * Wheel is bound by hand rather than with `onWheel`, because React attaches its own
   * wheel listener passively: `preventDefault()` inside a JSX handler is ignored, and
   * the page scrolls behind the canvas while it zooms.
   */
  useEffect(() => {
    const canvas = canvasRef.current;

    if (canvas === null) {
      return undefined;
    }

    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      zoom(event.deltaY < 0 ? WHEEL_ZOOM_FACTOR : 1 / WHEEL_ZOOM_FACTOR);
    };

    canvas.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      canvas.removeEventListener('wheel', onWheel);
    };
  }, [zoom]);

  const beginDrag = (event: ReactPointerEvent<SVGSVGElement>): void => {
    dragRef.current = {
      pointerId: event.pointerId,
      unitsPerPixel: viewBoxUnitsPerPixel(event.currentTarget.getBoundingClientRect(), bounds),
      lastX: event.clientX,
      lastY: event.clientY,
      movement: 0,
    };
  };

  const continueDrag = (event: ReactPointerEvent<SVGSVGElement>): void => {
    const drag = dragRef.current;

    if (drag === null || drag.pointerId !== event.pointerId) {
      return;
    }

    const dx = event.clientX - drag.lastX;
    const dy = event.clientY - drag.lastY;

    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    drag.movement += Math.abs(dx) + Math.abs(dy);

    setViewport((current) =>
      panViewport(current, dx * drag.unitsPerPixel, dy * drag.unitsPerPixel),
    );
  };

  const endDrag = (): void => {
    const drag = dragRef.current;

    if (drag === null) {
      return;
    }

    tapSuppressedRef.current = dragSuppressesClick(drag.movement);
    dragRef.current = null;
  };

  /*
   * `pointerup` runs before the `click` it produces, so by the time a node is asked to
   * open, the drag that may have ended on it has already had its say.
   *
   * ⚠ A keyboard activation is never a drag, and asks no permission. Routing it through
   * the same flag would eat the first Enter after any pan — the flag is only cleared by
   * the tap it cancels, and a keyboard user never makes that tap.
   */
  const openPerson = (person: Person, gesture: Gesture): void => {
    if (gesture === 'tap' && tapSuppressedRef.current) {
      tapSuppressedRef.current = false;

      return;
    }

    onOpenPerson(person);
  };

  return (
    <div className="graph-viz">
      <svg
        ref={canvasRef}
        className="graph-viz__canvas"
        viewBox={`${bounds.minX} ${bounds.minY} ${bounds.width} ${bounds.height}`}
        preserveAspectRatio="xMidYMid meet"
        aria-label="Your network"
        onPointerDown={beginDrag}
        onPointerMove={continueDrag}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
        onPointerCancel={endDrag}
      >
        <g transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.scale})`}>
          {layout.edges.map((edge) => (
            <line
              key={`${edge.personAId}~${edge.personBId}`}
              className="graph-viz__edge"
              data-strength={edge.strength}
              data-testid={edgeTestId(edge, viewerId, peopleById)}
              x1={edge.x1}
              y1={edge.y1}
              x2={edge.x2}
              y2={edge.y2}
            />
          ))}

          {layout.nodes.map((node) => (
            <GraphNode
              key={node.userId}
              node={node}
              person={peopleById.get(node.userId)}
              onOpen={openPerson}
            />
          ))}
        </g>
      </svg>

      <div className="graph-viz__zoom">
        <button
          className="icon-button"
          type="button"
          aria-label="Zoom in"
          onClick={() => {
            zoom(BUTTON_ZOOM_FACTOR);
          }}
        >
          +
        </button>
        <button
          className="icon-button"
          type="button"
          aria-label="Zoom out"
          onClick={() => {
            zoom(1 / BUTTON_ZOOM_FACTOR);
          }}
        >
          −
        </button>
        <button
          className="icon-button"
          type="button"
          aria-label="Fit the whole network"
          onClick={() => {
            setViewport(FITTED_VIEWPORT);
          }}
        >
          ◎
        </button>
      </div>

      <p className="graph-viz__caption">drag to pan · zoom into a cluster · tap a person</p>
    </div>
  );
}

/**
 * The identifier the e2e walk keys the viewer's own connection lines on.
 *
 * Only a line the viewer stands on gets one, and only when the person at the other end
 * has a handle to name it with — a person the projection hid has no public name to key
 * on, and inventing one from their `userId` would undo the projection.
 */
function edgeTestId(
  edge: GraphLayoutEdge,
  viewerId: string | undefined,
  peopleById: ReadonlyMap<string, Person>,
): string | undefined {
  if (viewerId === undefined) {
    return undefined;
  }

  const otherId =
    edge.personAId === viewerId
      ? edge.personBId
      : edge.personBId === viewerId
        ? edge.personAId
        : undefined;

  if (otherId === undefined) {
    return undefined;
  }

  const handle = peopleById.get(otherId)?.handle;

  return handle === undefined ? undefined : `graph-connection-edge-${handle}`;
}

/**
 * One person, as a dot.
 *
 * ⚠ The interactive element is the **dot**, not the group around it. A group's box
 * grows with the name written under it, so its centre — where a click lands — can miss
 * the circle entirely for a long name. The dot's centre is always the dot.
 *
 * The viewer's own node is deliberately not interactive: there is no person sheet to
 * open for yourself, which is why the comp leaves its `onTap` undefined too.
 */
function GraphNode({
  node,
  person,
  onOpen,
}: {
  readonly node: GraphLayoutNode;
  readonly person: Person | undefined;
  readonly onOpen: (person: Person, gesture: Gesture) => void;
}): JSX.Element {
  const isViewer = node.degree === VIEWER_DEGREE;
  const initial = person === undefined ? undefined : nodeInitial(person);
  const name = person === undefined ? undefined : nodeLabel(person);
  const label = isViewer ? 'You' : name;
  const withheld = !isViewer && name === undefined;
  const interactive = !isViewer && person !== undefined;
  const handle = person?.handle;

  // Built only when there is a person to open: "an interactive node has a person" is
  // carried by the callback's type, not re-checked by anyone downstream.
  const openOnTap =
    person === undefined
      ? undefined
      : (): void => {
          onOpen(person, 'tap');
        };

  const openOnKey =
    person === undefined
      ? undefined
      : (event: ReactKeyboardEvent<SVGCircleElement>): void => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onOpen(person, 'key');
          }
        };

  return (
    <g
      className="graph-viz__node"
      data-degree={node.degree}
      data-palette={node.paletteIndex}
      data-private={withheld ? 'true' : undefined}
      data-you={isViewer ? 'true' : undefined}
      transform={`translate(${node.x} ${node.y})`}
    >
      {isViewer ? (
        <>
          <circle className="graph-viz__halo" r={node.radius * HALO_SPREAD} />
          <circle
            className="graph-viz__you-ring graph-viz__you-ring--inner"
            r={node.radius + INNER_RING_INSET}
          />
          <circle
            className="graph-viz__you-ring graph-viz__you-ring--outer"
            r={node.radius + OUTER_RING_INSET}
          />
        </>
      ) : null}

      <circle
        className="graph-viz__dot"
        r={node.radius}
        role={interactive ? 'button' : undefined}
        tabIndex={interactive ? 0 : undefined}
        aria-label={interactive ? (name ?? 'Private connection') : undefined}
        data-testid={
          interactive && handle !== undefined ? `graph-connection-node-${handle}` : undefined
        }
        onClick={interactive ? openOnTap : undefined}
        onKeyDown={interactive ? openOnKey : undefined}
      />

      {initial === undefined ? null : (
        <text className="graph-viz__initial" dy="0.35em">
          {initial}
        </text>
      )}

      {label === undefined || node.degree > LABELLED_DEGREE ? null : (
        <text className="graph-viz__label" y={node.radius + LABEL_GAP}>
          {label}
        </text>
      )}
    </g>
  );
}
