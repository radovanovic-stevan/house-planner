import { cross, dist, projectOnSegment, samePoint, sub, wallLength, add, scale } from './geometry';
import { DEFAULTS, newId, type Opening, type Plan, type Vec2, type Wall } from './model';

const ON_WALL_EPS = 1e-3;

export interface EndpointRef {
  wallId: string;
  end: 'a' | 'b';
}

export function getWall(plan: Plan, id: string) {
  return plan.walls.find((w) => w.id === id);
}

/** All wall endpoints located at `p`. */
export function endpointsAt(plan: Plan, p: Vec2, eps = 1e-3): EndpointRef[] {
  const refs: EndpointRef[] = [];
  for (const w of plan.walls) {
    if (samePoint(w.a, p, eps)) refs.push({ wallId: w.id, end: 'a' });
    if (samePoint(w.b, p, eps)) refs.push({ wallId: w.id, end: 'b' });
  }
  return refs;
}

/** Nearest wall to `p` whose body (plus tolerance) contains it. */
export function wallAt(plan: Plan, p: Vec2, tolerance: number): { wall: Wall; along: number; dist: number } | null {
  let best: { wall: Wall; along: number; dist: number } | null = null;
  for (const w of plan.walls) {
    const pr = projectOnSegment(p, w.a, w.b);
    if (pr.dist <= w.thickness / 2 + tolerance && (!best || pr.dist < best.dist)) {
      best = { wall: w, along: pr.along, dist: pr.dist };
    }
  }
  return best;
}

/** Splits `wall` at distance `along` from its start. Returns the new wall (second half) or null. */
export function splitWall(plan: Plan, wall: Wall, along: number): Wall | null {
  const L = wallLength(wall);
  if (along <= ON_WALL_EPS || along >= L - ON_WALL_EPS) return null;
  const p = add(wall.a, scale(sub(wall.b, wall.a), along / L));
  const second: Wall = { ...wall, id: newId('w'), a: { ...p }, b: { ...wall.b } };
  wall.b = { ...p };
  plan.walls.push(second);
  for (const o of plan.openings) {
    if (o.wallId === wall.id && o.offset > along) {
      o.wallId = second.id;
      o.offset -= along;
    }
  }
  for (const o of plan.openings) if (o.wallId === wall.id || o.wallId === second.id) clampOpening(plan, o);
  return second;
}

/** Splits any wall whose interior contains `p`. */
export function splitWallsAtPoint(plan: Plan, p: Vec2) {
  for (const w of [...plan.walls]) {
    const pr = projectOnSegment(p, w.a, w.b);
    if (pr.dist < ON_WALL_EPS) splitWall(plan, w, pr.along);
  }
}

/** Intersection of segments ab and cd strictly inside both, or null. */
function segmentIntersection(a: Vec2, b: Vec2, c: Vec2, d: Vec2): Vec2 | null {
  const r = sub(b, a);
  const s = sub(d, c);
  const denom = cross(r, s);
  if (Math.abs(denom) < 1e-9) return null;
  const t = cross(sub(c, a), s) / denom;
  const u = cross(sub(c, a), r) / denom;
  const e = 1e-6;
  if (t <= e || t >= 1 - e || u <= e || u >= 1 - e) return null;
  return add(a, scale(r, t));
}

/**
 * Adds a wall from a to b, keeping the wall network connected: existing walls are split
 * where the new wall starts, ends or crosses them, and the new wall is split where
 * existing walls end on or cross it. Returns the created wall pieces.
 */
export function addWall(plan: Plan, a: Vec2, b: Vec2, thickness = DEFAULTS.wallThickness, height = DEFAULTS.wallHeight): Wall[] {
  if (dist(a, b) < 0.01) return [];
  const cuts: number[] = [];
  const L = dist(a, b);

  splitWallsAtPoint(plan, a);
  splitWallsAtPoint(plan, b);

  for (const w of [...plan.walls]) {
    const x = segmentIntersection(a, b, w.a, w.b);
    if (x) {
      splitWallsAtPoint(plan, x);
      cuts.push(dist(a, x));
    }
  }
  for (const w of plan.walls) {
    for (const p of [w.a, w.b]) {
      const pr = projectOnSegment(p, a, b);
      if (pr.dist < ON_WALL_EPS && pr.along > ON_WALL_EPS && pr.along < L - ON_WALL_EPS) cuts.push(pr.along);
    }
  }

  const stops = [0, ...cuts.sort((x, y) => x - y), L].filter((v, i, arr) => i === 0 || v - arr[i - 1] > ON_WALL_EPS);
  const dir = scale(sub(b, a), 1 / L);
  const created: Wall[] = [];
  for (let i = 0; i < stops.length - 1; i++) {
    const pa = add(a, scale(dir, stops[i]));
    const pb = i === stops.length - 2 ? { ...b } : add(a, scale(dir, stops[i + 1]));
    if (isDuplicateWall(plan, pa, pb)) continue;
    const w: Wall = { id: newId('w'), a: pa, b: pb, thickness, height };
    plan.walls.push(w);
    created.push(w);
  }
  return created;
}

function isDuplicateWall(plan: Plan, a: Vec2, b: Vec2) {
  return plan.walls.some((w) => (samePoint(w.a, a) && samePoint(w.b, b)) || (samePoint(w.a, b) && samePoint(w.b, a)));
}

/** After endpoints were dragged around: split walls that endpoints now land on, drop degenerate walls. */
export function healWalls(plan: Plan) {
  const degenerate = plan.walls.filter((w) => wallLength(w) < 0.01).map((w) => w.id);
  for (const id of degenerate) deleteWall(plan, id);
  for (const w of [...plan.walls]) {
    splitWallsAtPoint(plan, w.a);
    splitWallsAtPoint(plan, w.b);
  }
}

export function deleteWall(plan: Plan, id: string) {
  plan.walls = plan.walls.filter((w) => w.id !== id);
  plan.openings = plan.openings.filter((o) => o.wallId !== id);
}

export function deleteSelection(plan: Plan, kind: 'wall' | 'opening' | 'furniture', id: string) {
  if (kind === 'wall') deleteWall(plan, id);
  else if (kind === 'opening') plan.openings = plan.openings.filter((o) => o.id !== id);
  else plan.furniture = plan.furniture.filter((f) => f.id !== id);
}

/** Keeps an opening inside its wall. */
export function clampOpening(plan: Plan, o: Opening) {
  const w = getWall(plan, o.wallId);
  if (!w) return;
  const L = wallLength(w);
  if (o.width >= L) {
    o.offset = L / 2;
    return;
  }
  o.offset = Math.max(o.width / 2, Math.min(L - o.width / 2, o.offset));
}

export function clampOpeningsOnWall(plan: Plan, wallId: string) {
  for (const o of plan.openings) if (o.wallId === wallId) clampOpening(plan, o);
}

/** Sets a wall's length by moving its `b` end (and any endpoints joined to it). */
export function setWallLength(plan: Plan, w: Wall, length: number) {
  const L = wallLength(w);
  if (L < 1e-6 || length <= 0.01) return;
  const newB = add(w.a, scale(sub(w.b, w.a), length / L));
  const refs = endpointsAt(plan, w.b);
  for (const r of refs) {
    const ww = getWall(plan, r.wallId)!;
    ww[r.end] = { ...newB };
    clampOpeningsOnWall(plan, ww.id);
  }
}

const pointKey = (p: Vec2) => `${Math.round(p.x * 1000)},${Math.round(p.y * 1000)}`;

/**
 * How far each wall end should be extended so corners close up: joined ends are
 * extended by half the wall thickness, free ends are not.
 */
export function wallEndExtensions(plan: Plan): Map<string, { a: number; b: number }> {
  const degree = new Map<string, number>();
  for (const w of plan.walls) {
    for (const p of [w.a, w.b]) degree.set(pointKey(p), (degree.get(pointKey(p)) ?? 0) + 1);
  }
  const result = new Map<string, { a: number; b: number }>();
  for (const w of plan.walls) {
    result.set(w.id, {
      a: (degree.get(pointKey(w.a)) ?? 0) > 1 ? w.thickness / 2 : 0,
      b: (degree.get(pointKey(w.b)) ?? 0) > 1 ? w.thickness / 2 : 0,
    });
  }
  return result;
}

/** The wall plus every wall joined to it end-to-end along the same straight line. */
export function collinearRun(plan: Plan, wall: Wall): Wall[] {
  const d = sub(wall.b, wall.a);
  const run = new Set<Wall>([wall]);
  const queue = [wall];
  while (queue.length) {
    const w = queue.pop()!;
    for (const p of [w.a, w.b]) {
      for (const r of endpointsAt(plan, p)) {
        const other = getWall(plan, r.wallId)!;
        if (run.has(other)) continue;
        const od = sub(other.b, other.a);
        if (Math.abs(cross(d, od)) / (Math.hypot(d.x, d.y) * Math.hypot(od.x, od.y)) < 1e-3) {
          run.add(other);
          queue.push(other);
        }
      }
    }
  }
  return [...run];
}
