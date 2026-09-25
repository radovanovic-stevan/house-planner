import { add, normalize, perp, polygonArea, polygonCentroid, samePoint, scale, sub, cross } from './geometry';
import type { Plan, Vec2 } from './model';

export interface Room {
  /** Polygon along wall center lines. */
  outline: Vec2[];
  /** Polygon along the inner faces of the walls (the actual floor). */
  floor: Vec2[];
  /** Net floor area in m². */
  area: number;
  center: Vec2;
}

interface HalfEdge {
  from: number;
  to: number;
  angle: number;
  thickness: number;
  used: boolean;
}

const key = (p: Vec2) => `${Math.round(p.x * 1000)},${Math.round(p.y * 1000)}`;

/**
 * Finds the enclosed regions of the wall network by walking the faces of the planar graph
 * formed by the walls (walls are kept split at junctions by ops.ts).
 */
export function findRooms(plan: Plan): Room[] {
  const nodes: Vec2[] = [];
  const nodeIndex = new Map<string, number>();
  const nodeOf = (p: Vec2) => {
    const k = key(p);
    let i = nodeIndex.get(k);
    if (i === undefined) {
      i = nodes.length;
      nodes.push({ x: p.x, y: p.y });
      nodeIndex.set(k, i);
    }
    return i;
  };

  const out: HalfEdge[][] = [];
  const seen = new Set<string>();
  for (const w of plan.walls) {
    const u = nodeOf(w.a);
    const v = nodeOf(w.b);
    if (u === v) continue;
    const ek = u < v ? `${u}-${v}` : `${v}-${u}`;
    if (seen.has(ek)) continue;
    seen.add(ek);
    for (const [f, t] of [
      [u, v],
      [v, u],
    ]) {
      (out[f] ??= []).push({
        from: f,
        to: t,
        angle: Math.atan2(nodes[t].y - nodes[f].y, nodes[t].x - nodes[f].x),
        thickness: w.thickness,
        used: false,
      });
    }
  }
  for (const list of out) list?.sort((a, b) => a.angle - b.angle);

  const rooms: Room[] = [];
  for (const list of out) {
    if (!list) continue;
    for (const start of list) {
      if (start.used) continue;
      const cycle: HalfEdge[] = [];
      let e: HalfEdge | undefined = start;
      let guard = 0;
      while (e && !e.used && guard++ < 10000) {
        e.used = true;
        cycle.push(e);
        // At the target node, take the edge right after the reverse edge in angular order:
        // this keeps the face on the same side and traces its boundary.
        const around: HalfEdge[] = out[e.to];
        const back = around.findIndex((h) => h.to === e!.from);
        e = around[(back - 1 + around.length) % around.length];
      }
      if (cycle.length < 3) continue;
      const outline = cycle.map((h) => nodes[h.from]);
      const signed = polygonArea(outline);
      // Bounded faces come out with positive signed area with this walk;
      // the unbounded outer face of each wall group has negative area.
      if (signed < 1e-3) continue;
      const cleaned = removeSpikes(cycle.map((h) => ({ p: nodes[h.from], t: h.thickness })));
      if (cleaned.length < 3) continue;
      const floor = insetPolygon(cleaned);
      const area = Math.abs(polygonArea(floor));
      if (area < 0.05) continue;
      rooms.push({ outline, floor, area, center: polygonCentroid(floor) });
    }
  }
  return rooms;
}

interface Vertex {
  p: Vec2;
  /** Thickness of the wall that goes from this vertex to the next. */
  t: number;
}

/** Removes dangling walls (A -> B -> A back-tracks) that poke into a room. */
function removeSpikes(vs: Vertex[]): Vertex[] {
  let changed = true;
  let list = vs.slice();
  while (changed && list.length >= 3) {
    changed = false;
    for (let i = 0; i < list.length; i++) {
      const prev = list[(i - 1 + list.length) % list.length];
      const next = list[(i + 1) % list.length];
      if (samePoint(prev.p, next.p)) {
        // drop the spike tip and the duplicate return point
        const drop = new Set([i, (i + 1) % list.length]);
        list = list.filter((_, j) => !drop.has(j));
        changed = true;
        break;
      }
    }
  }
  return list;
}

/** Offsets every edge inward by half its wall thickness. Polygon has positive signed area (see above). */
function insetPolygon(vs: Vertex[]): Vec2[] {
  const n = vs.length;
  const lines = vs.map((v, i) => {
    const a = v.p;
    const b = vs[(i + 1) % n].p;
    const d = normalize(sub(b, a));
    // For this winding, the interior lies on the perp side of each edge.
    const off = scale(perp(d), v.t / 2);
    return { p: add(a, off), d };
  });
  return vs.map((_, i) => {
    const l1 = lines[(i - 1 + n) % n];
    const l2 = lines[i];
    const denom = cross(l1.d, l2.d);
    if (Math.abs(denom) < 1e-9) return l2.p;
    const t = cross(sub(l2.p, l1.p), l2.d) / denom;
    return add(l1.p, scale(l1.d, t));
  });
}
