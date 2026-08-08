import type { Edge, Graph, Person } from '@playa-post/contracts';

/**
 * Turning a `graph.list` payload into a drawable picture: where every node sits, which
 * lines join them, and how big a box holds the result.
 *
 * The comp (`design/Playa Post.dc.html`, `namedPos`/`net()`) hand-places 13 people on a
 * 1200x1200 canvas and fabricates ~88 more around them with a seeded PRNG. Neither is
 * available here: the server sends people and edges, never coordinates, and it never
 * will — a layout is a picture, and the picture is the client's job. What this module
 * keeps from the comp is the *shape* of that picture (viewer at the centre, degree
 * rings around them, connected people clustered together) and derives every coordinate
 * from the person identifiers themselves.
 *
 * **Pure and deterministic.** No clock, no randomness, no DOM. The same graph produces
 * byte-identical geometry on every device and every render, in any order the payload
 * happens to arrive in — which is what lets React re-render on a poll without the
 * network reshuffling itself under the user's finger.
 */

const TAU = Math.PI * 2;

/** Node diameters by degree, from the comp: you 58, first degree 46, second 30, past that 22. */
const NODE_DIAMETERS = [58, 46, 30, 22] as const;
const SMALLEST_NODE_DIAMETER = 22;

/** The gap between one degree ring and the next, before packing widens it. */
const RING_STEP = 160;

/**
 * How much room each node claims along its ring, as a multiple of its own diameter.
 *
 * ⚠ This is what stops a wide network from stacking on itself. A ring's radius grows
 * with its population, so twelve connections and eighty connections are both legible;
 * lowering it packs nodes until they overlap and the picture stops being readable.
 */
const RING_PACKING = 1.9;

/** How far a node may drift in and out of its ring, so a ring reads as organic, not machined. */
const RADIUS_JITTER = 0.16;

/**
 * How far a node may drift around its slot, as a fraction of the slot.
 *
 * ⚠ Kept well under 1 so drift can never reorder a ring — the cluster ordering below is
 * the whole reason connected people end up beside each other, and an angular wobble
 * large enough to swap two neighbours would undo it.
 */
const ANGLE_JITTER = 0.18;

/**
 * Where a ring's first slot sits.
 *
 * ⚠ Deliberately **off** the vertical axis. Straight up would put the single-connection
 * case — the commonest graph there is — on a perfectly vertical line from the centre,
 * and a zero-width line has an empty bounding box: invisible to hit-testing, to
 * `getBoundingClientRect`, and to any test that asks whether the edge rendered.
 */
const FIRST_SLOT_ANGLE = -Math.PI / 2 + 0.14;

/** Breathing room around the outermost node, so a glow or focus ring is not clipped. */
const CANVAS_PADDING = 40;

/** How many node colours the palette cycles through (the comp's `avL`/`neon` arrays). */
export const NODE_PALETTE_SIZE = 6;

/** The degree the viewer themselves carries — `app.visible_people` seeds the traversal at them. */
const VIEWER_DEGREE = 0;

/** Trust at or above this reads as a strong line; the comp's `trustW` upper step. */
const STRONG_TRUST = 75;
/** Trust at or above this reads as a medium line; the comp's `trustW` middle step. */
const MEDIUM_TRUST = 40;

/** One person, placed. */
export interface GraphLayoutNode {
  readonly userId: string;
  /** Hops from the viewer. `0` is the viewer themselves. */
  readonly degree: number;
  readonly x: number;
  readonly y: number;
  /** Half the comp's diameter for this degree, in canvas units. */
  readonly radius: number;
  /** A stable index into the node palette, in `[0, NODE_PALETTE_SIZE)`. */
  readonly paletteIndex: number;
}

/** One connection, placed. */
export interface GraphLayoutEdge {
  readonly personAId: string;
  readonly personBId: string;
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  /**
   * How heavily to draw this line: `1`, `2`, or `3`.
   *
   * ⚠ **Only an edge the viewer stands on can be anything but `1`.** The weight is the
   * viewer's own trust in the person at the other end, which is theirs to see
   * (ADR-0004 decision 6). An edge between two *other* people has no weight anybody is
   * entitled to, so it is always `1` — inferring one from degree, proximity or edge
   * count would invent a number the server deliberately refuses to send.
   */
  readonly strength: number;
}

/** The box that holds the whole picture — the SVG `viewBox`, in canvas units. */
export interface GraphLayoutBounds {
  readonly minX: number;
  readonly minY: number;
  readonly width: number;
  readonly height: number;
}

/** A `graph.list` payload, drawn. */
export interface GraphLayout {
  readonly nodes: readonly GraphLayoutNode[];
  readonly edges: readonly GraphLayoutEdge[];
  readonly bounds: GraphLayoutBounds;
}

/**
 * A stable number in `[0, 1)` for a string — FNV-1a, then normalised.
 *
 * The comp seeds a linear-congruential generator with `42` and walks it; this seeds
 * from the identifier itself instead, so a person keeps their place in the picture when
 * somebody else joins the network. A rearranging graph is a graph nobody can learn.
 */
function hashUnitInterval(value: string): number {
  let hash = 2_166_136_261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }

  return (hash >>> 0) / 4_294_967_296;
}

/**
 * Which ring a person belongs on.
 *
 * A degree that is not a usable whole number lands on the first ring rather than at the
 * centre: the centre means *you*, and a payload this function cannot read must never be
 * able to claim it.
 */
function ringOf(person: Person): number {
  return Number.isFinite(person.degree) ? Math.max(Math.trunc(person.degree), 0) : 1;
}

function nodeDiameter(ring: number): number {
  return NODE_DIAMETERS[Math.min(ring, NODE_DIAMETERS.length - 1)] ?? SMALLEST_NODE_DIAMETER;
}

/**
 * How far out a ring sits: far enough for its own population, and always outside the
 * ring within it.
 *
 * The lone viewer is the degenerate case — a ring of one at radius zero *is* a centred
 * node, which is why the centre needs no special path through the placement loop.
 */
function ringRadius(ring: number, population: number, innerRadius: number): number {
  if (ring === VIEWER_DEGREE && population === 1) {
    return 0;
  }

  const packed = (population * nodeDiameter(ring) * RING_PACKING) / TAU;

  return Math.max(RING_STEP * ring, packed, innerRadius + RING_STEP);
}

function link(adjacency: Map<string, string[]>, from: string, to: string): void {
  const neighbours = adjacency.get(from);

  if (neighbours === undefined) {
    adjacency.set(from, [to]);
  } else {
    neighbours.push(to);
  }
}

/** Who, among these people, is joined to whom — edges reaching outside the ring ignored. */
function neighboursWithin(
  members: ReadonlySet<string>,
  edges: readonly Edge[],
): ReadonlyMap<string, readonly string[]> {
  const adjacency = new Map<string, string[]>();

  for (const edge of edges) {
    if (
      edge.personAId === edge.personBId ||
      !members.has(edge.personAId) ||
      !members.has(edge.personBId)
    ) {
      continue;
    }

    link(adjacency, edge.personAId, edge.personBId);
    link(adjacency, edge.personBId, edge.personAId);
  }

  for (const neighbours of adjacency.values()) {
    neighbours.sort();
  }

  return adjacency;
}

/**
 * The order a ring is laid out in: people who know each other, side by side.
 *
 * This is the comp's clusters, earned from real edges rather than hand-placed. A
 * depth-first walk emits each connected group as one contiguous run, so a group of
 * mutuals lands as a wedge of the ring with short chords between them — which is what
 * makes a cluster look like a cluster. Seeds and neighbours are both visited in
 * identifier order, so the walk is a function of the graph and not of the payload's
 * arrival order.
 */
function clusterOrder(members: readonly string[], edges: readonly Edge[]): readonly string[] {
  const remaining = new Set(members);
  const adjacency = neighboursWithin(remaining, edges);
  const ordered: string[] = [];

  for (const seed of members) {
    if (!remaining.has(seed)) {
      continue;
    }

    const stack: string[] = [seed];

    while (stack.length > 0) {
      const current = stack.pop();

      if (current === undefined || !remaining.delete(current)) {
        continue;
      }

      ordered.push(current);

      const neighbours = adjacency.get(current) ?? [];

      // Reversed, so the smallest identifier comes off the stack first.
      for (let index = neighbours.length - 1; index >= 0; index -= 1) {
        const neighbour = neighbours[index];

        if (neighbour !== undefined && remaining.has(neighbour)) {
          stack.push(neighbour);
        }
      }
    }
  }

  return ordered;
}

/** The comp's `trustW`, as a tier rather than a stroke width. */
function trustStrength(trust: number | null): number {
  if (trust === null) {
    return 1;
  }

  if (trust >= STRONG_TRUST) {
    return 3;
  }

  return trust >= MEDIUM_TRUST ? 2 : 1;
}

function compareEdges(left: Edge, right: Edge): number {
  return (
    left.personAId.localeCompare(right.personAId) || left.personBId.localeCompare(right.personBId)
  );
}

/**
 * Place a viewer's graph.
 *
 * ⚠ **Nodes come from `people` and nowhere else.** An identifier that appears only in
 * `edges` is dropped along with its line: the payload's own contract says both endpoints
 * are always in `people`, so an identifier that is not there is a bug, and drawing a
 * node for it would put a stranger on the viewer's screen.
 */
export function layoutGraph(graph: Graph): GraphLayout {
  const peopleById = new Map(graph.people.map((person) => [person.userId, person]));
  const rings = new Map<number, string[]>();

  for (const person of graph.people) {
    const ring = ringOf(person);
    const members = rings.get(ring);

    if (members === undefined) {
      rings.set(ring, [person.userId]);
    } else {
      members.push(person.userId);
    }
  }

  const nodes: GraphLayoutNode[] = [];
  let innerRadius = -RING_STEP;

  for (const ring of [...rings.keys()].sort((left, right) => left - right)) {
    const members = (rings.get(ring) ?? []).sort();
    const radius = ringRadius(ring, members.length, innerRadius);

    innerRadius = radius;

    const ordered = clusterOrder(members, graph.edges);
    const slot = TAU / ordered.length;

    ordered.forEach((userId, index) => {
      const angle =
        FIRST_SLOT_ANGLE +
        index * slot +
        (hashUnitInterval(`${userId}:angle`) - 0.5) * ANGLE_JITTER * slot;
      const distance = radius * (1 + (hashUnitInterval(`${userId}:radius`) - 0.5) * RADIUS_JITTER);

      nodes.push({
        userId,
        degree: ring,
        x: distance * Math.cos(angle),
        y: distance * Math.sin(angle),
        radius: nodeDiameter(ring) / 2,
        paletteIndex: Math.floor(hashUnitInterval(`${userId}:palette`) * NODE_PALETTE_SIZE),
      });
    });
  }

  const placed = new Map(nodes.map((node) => [node.userId, node]));
  const viewerId = nodes.find((node) => node.degree === VIEWER_DEGREE)?.userId;
  const edges: GraphLayoutEdge[] = [];

  for (const edge of [...graph.edges].sort(compareEdges)) {
    const from = placed.get(edge.personAId);
    const to = placed.get(edge.personBId);

    if (from === undefined || to === undefined) {
      continue;
    }

    const other =
      edge.personAId === viewerId
        ? edge.personBId
        : edge.personBId === viewerId
          ? edge.personAId
          : undefined;

    edges.push({
      personAId: edge.personAId,
      personBId: edge.personBId,
      x1: from.x,
      y1: from.y,
      x2: to.x,
      y2: to.y,
      strength: other === undefined ? 1 : trustStrength(peopleById.get(other)?.trust ?? null),
    });
  }

  let minX = 0;
  let maxX = 0;
  let minY = 0;
  let maxY = 0;

  for (const node of nodes) {
    minX = Math.min(minX, node.x - node.radius);
    maxX = Math.max(maxX, node.x + node.radius);
    minY = Math.min(minY, node.y - node.radius);
    maxY = Math.max(maxY, node.y + node.radius);
  }

  return {
    nodes,
    edges,
    bounds: {
      minX: minX - CANVAS_PADDING,
      minY: minY - CANVAS_PADDING,
      width: maxX - minX + CANVAS_PADDING * 2,
      height: maxY - minY + CANVAS_PADDING * 2,
    },
  };
}
