import type { Vec2, Wall } from './model';

export const EPS = 1e-6;

export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
export const dot = (a: Vec2, b: Vec2) => a.x * b.x + a.y * b.y;
export const cross = (a: Vec2, b: Vec2) => a.x * b.y - a.y * b.x;
export const len = (a: Vec2) => Math.hypot(a.x, a.y);
export const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);
export const samePoint = (a: Vec2, b: Vec2, eps = 1e-4) => dist(a, b) < eps;

export function normalize(a: Vec2): Vec2 {
  const l = len(a);
  return l < EPS ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l };
}

/** Left-hand perpendicular in screen space (y down). */
export const perp = (a: Vec2): Vec2 => ({ x: -a.y, y: a.x });

export const wallLength = (w: Wall) => dist(w.a, w.b);
export const wallDir = (w: Wall) => normalize(sub(w.b, w.a));

export function pointAlongWall(w: Wall, t: number): Vec2 {
  return add(w.a, scale(wallDir(w), t));
}

/** Projects p onto segment ab. Returns distance along the segment (clamped) and the distance to it. */
export function projectOnSegment(p: Vec2, a: Vec2, b: Vec2) {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  if (l2 < EPS) return { t: 0, along: 0, dist: dist(p, a), point: a };
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
  const point = add(a, scale(ab, t));
  return { t, along: t * Math.sqrt(l2), dist: dist(p, point), point };
}

export function snapToGrid(p: Vec2, step: number): Vec2 {
  if (step <= 0) return p;
  return { x: Math.round(p.x / step) * step, y: Math.round(p.y / step) * step };
}

/** Constrains `p` so that the segment from `origin` is at a multiple of 45 degrees. */
export function snapAngle(origin: Vec2, p: Vec2, stepDeg = 45): Vec2 {
  const d = sub(p, origin);
  const l = len(d);
  if (l < EPS) return p;
  const step = (stepDeg * Math.PI) / 180;
  const ang = Math.round(Math.atan2(d.y, d.x) / step) * step;
  return { x: origin.x + Math.cos(ang) * l, y: origin.y + Math.sin(ang) * l };
}

/** Signed polygon area (positive for clockwise on screen since y is down). */
export function polygonArea(pts: Vec2[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

export function polygonCentroid(pts: Vec2[]): Vec2 {
  const area = polygonArea(pts);
  if (Math.abs(area) < EPS) {
    const s = pts.reduce((acc, p) => add(acc, p), { x: 0, y: 0 });
    return scale(s, 1 / Math.max(1, pts.length));
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const f = a.x * b.y - b.x * a.y;
    cx += (a.x + b.x) * f;
    cy += (a.y + b.y) * f;
  }
  return { x: cx / (6 * area), y: cy / (6 * area) };
}

export function pointInPolygon(p: Vec2, pts: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Corners of a rotated rectangle (rotation in degrees, clockwise on screen). */
export function rectCorners(cx: number, cy: number, w: number, l: number, rotDeg: number): Vec2[] {
  const r = (rotDeg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [
    [-w / 2, -l / 2],
    [w / 2, -l / 2],
    [w / 2, l / 2],
    [-w / 2, l / 2],
  ].map(([x, y]) => ({ x: cx + x * c - y * s, y: cy + x * s + y * c }));
}

/** Formats meters with up to 2 decimals, trimming trailing zeros. */
export function fmt(m: number, digits = 2): string {
  return (Math.round(m * 10 ** digits) / 10 ** digits).toString();
}
