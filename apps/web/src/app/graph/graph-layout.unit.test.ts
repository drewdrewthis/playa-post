import { describe, expect, it } from 'vitest';

import type { Edge, Graph, Person } from '@playa-post/contracts';

import {
  layoutGraph,
  NODE_PALETTE_SIZE,
  type GraphLayout,
  type GraphLayoutNode,
} from './graph-layout';

const TAU = Math.PI * 2;

function person(userId: string, degree: number, trust: number | null = null): Person {
  return { userId, degree, disclosure: 'full', displayName: userId, handle: userId, trust };
}

/** Canonically ordered, the way `graph.list` promises to send one. */
function edge(left: string, right: string): Edge {
  return left < right
    ? { personAId: left, personBId: right }
    : { personAId: right, personBId: left };
}

function nodeFor(layout: GraphLayout, userId: string): GraphLayoutNode {
  const found = layout.nodes.find((node) => node.userId === userId);

  if (found === undefined) {
    throw new Error(`no node for ${userId}`);
  }

  return found;
}

/** The identifiers of `ids`, read clockwise around the ring they share. */
function ringOrder(layout: GraphLayout, ids: readonly string[]): readonly string[] {
  return ids
    .map((userId) => nodeFor(layout, userId))
    .map((node) => ({ userId: node.userId, angle: (Math.atan2(node.y, node.x) + TAU) % TAU }))
    .sort((left, right) => left.angle - right.angle)
    .map((entry) => entry.userId);
}

/** The same cyclic sequence, rotated to begin at `start`, so a ring can be compared as a list. */
function startingAt(order: readonly string[], start: string): readonly string[] {
  const at = order.indexOf(start);

  return [...order.slice(at), ...order.slice(0, at)];
}

function distance(
  left: { readonly x: number; readonly y: number },
  right: { readonly x: number; readonly y: number },
): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

describe('layoutGraph', () => {
  it('puts the viewer at the centre', () => {
    const layout = layoutGraph({ people: [person('you', 0)], edges: [] });

    expect(distance(nodeFor(layout, 'you'), { x: 0, y: 0 })).toBe(0);
  });

  it('rings the viewer with their connections', () => {
    const layout = layoutGraph({
      people: [person('you', 0), person('a', 1), person('b', 1)],
      edges: [edge('you', 'a'), edge('you', 'b')],
    });

    const first = nodeFor(layout, 'a');
    const second = nodeFor(layout, 'b');

    expect(distance(first, { x: 0, y: 0 })).toBeGreaterThan(0);
    expect(distance(second, { x: 0, y: 0 })).toBeGreaterThan(0);
    expect(distance(first, second)).toBeGreaterThan(first.radius + second.radius);
  });

  it('draws no node for an identifier that appears only in an edge', () => {
    const layout = layoutGraph({
      people: [person('you', 0), person('a', 1)],
      edges: [edge('you', 'a'), edge('a', 'stranger')],
    });

    expect(layout.nodes.map((node) => node.userId).sort()).toEqual(['a', 'you']);
    expect(layout.edges).toHaveLength(1);
    expect(layout.edges[0]).toMatchObject({ personAId: 'a', personBId: 'you' });
  });

  it('is deterministic: the same graph draws the same picture', () => {
    const graph: Graph = {
      people: [person('you', 0), person('a', 1), person('b', 1), person('c', 1)],
      edges: [edge('you', 'a'), edge('you', 'b'), edge('you', 'c'), edge('a', 'b')],
    };

    expect(layoutGraph(graph)).toEqual(layoutGraph(graph));
  });

  it('does not depend on the order people and edges arrive in', () => {
    const people = [person('you', 0), person('a', 1), person('b', 1), person('c', 1)];
    const edges = [edge('you', 'a'), edge('you', 'b'), edge('you', 'c'), edge('b', 'c')];

    const asSent = layoutGraph({ people, edges });
    const reversed = layoutGraph({ people: [...people].reverse(), edges: [...edges].reverse() });

    expect(reversed).toEqual(asSent);
  });

  it('seats people who know each other beside each other on their ring', () => {
    // Identifier order alone would be p1, p2, p3, p4 — the clusters cut across it.
    const layout = layoutGraph({
      people: [person('you', 0), person('p1', 1), person('p2', 1), person('p3', 1), person('p4', 1)],
      edges: [
        edge('you', 'p1'),
        edge('you', 'p2'),
        edge('you', 'p3'),
        edge('you', 'p4'),
        edge('p1', 'p3'),
        edge('p2', 'p4'),
      ],
    });

    const ring = startingAt(ringOrder(layout, ['p1', 'p2', 'p3', 'p4']), 'p1');

    expect(ring).toEqual(['p1', 'p3', 'p2', 'p4']);
  });

  it('widens a ring as it fills, so nodes never overlap', () => {
    const connections = Array.from({ length: 30 }, (_, index) =>
      person(`person-${String(index).padStart(2, '0')}`, 1),
    );

    const layout = layoutGraph({
      people: [person('you', 0), ...connections],
      edges: connections.map((connection) => edge('you', connection.userId)),
    });

    for (const [index, left] of layout.nodes.entries()) {
      for (const right of layout.nodes.slice(index + 1)) {
        expect(distance(left, right)).toBeGreaterThanOrEqual(left.radius + right.radius);
      }
    }
  });

  it('pushes each degree outside the one within it', () => {
    const layout = layoutGraph({
      people: [person('you', 0), person('near', 1), person('far', 2)],
      edges: [edge('you', 'near'), edge('near', 'far')],
    });

    const near = distance(nodeFor(layout, 'near'), { x: 0, y: 0 });
    const far = distance(nodeFor(layout, 'far'), { x: 0, y: 0 });

    expect(near).toBeGreaterThan(0);
    expect(far).toBeGreaterThan(near);
    expect(nodeFor(layout, 'far').radius).toBeLessThan(nodeFor(layout, 'near').radius);
  });

  it('weights an edge the viewer stands on by their own trust, and every other edge alike', () => {
    const layout = layoutGraph({
      people: [
        person('you', 0),
        person('close', 1, 90),
        person('warm', 1, 50),
        person('cool', 1, 10),
        person('unset', 1, null),
      ],
      edges: [
        edge('you', 'close'),
        edge('you', 'warm'),
        edge('you', 'cool'),
        edge('you', 'unset'),
        // Between two other people: the payload carries no weight, so neither may this.
        edge('close', 'warm'),
      ],
    });

    const strengthOf = (left: string, right: string): number | undefined => {
      const wanted = edge(left, right);

      return layout.edges.find(
        (candidate) =>
          candidate.personAId === wanted.personAId && candidate.personBId === wanted.personBId,
      )?.strength;
    };

    expect(strengthOf('you', 'close')).toBe(3);
    expect(strengthOf('you', 'warm')).toBe(2);
    expect(strengthOf('you', 'cool')).toBe(1);
    expect(strengthOf('you', 'unset')).toBe(1);
    expect(strengthOf('close', 'warm')).toBe(1);
  });

  it('gives every person a stable palette index inside the palette', () => {
    const graph: Graph = {
      people: [person('you', 0), person('a', 1), person('b', 1)],
      edges: [],
    };

    for (const node of layoutGraph(graph).nodes) {
      expect(node.paletteIndex).toBeGreaterThanOrEqual(0);
      expect(node.paletteIndex).toBeLessThan(NODE_PALETTE_SIZE);
      expect(Number.isInteger(node.paletteIndex)).toBe(true);
      expect(node.paletteIndex).toBe(nodeFor(layoutGraph(graph), node.userId).paletteIndex);
    }
  });

  it('bounds a canvas that holds every node whole', () => {
    const layout = layoutGraph({
      people: [person('you', 0), person('a', 1), person('b', 1), person('c', 1)],
      edges: [edge('you', 'a'), edge('you', 'b'), edge('you', 'c')],
    });

    const { minX, minY, width, height } = layout.bounds;

    for (const node of layout.nodes) {
      expect(node.x - node.radius).toBeGreaterThanOrEqual(minX);
      expect(node.x + node.radius).toBeLessThanOrEqual(minX + width);
      expect(node.y - node.radius).toBeGreaterThanOrEqual(minY);
      expect(node.y + node.radius).toBeLessThanOrEqual(minY + height);
    }
  });

  it('still bounds a usable canvas when there is nobody to draw', () => {
    const layout = layoutGraph({ people: [], edges: [] });

    expect(layout.nodes).toEqual([]);
    expect(layout.bounds.width).toBeGreaterThan(0);
    expect(layout.bounds.height).toBeGreaterThan(0);
  });
});
