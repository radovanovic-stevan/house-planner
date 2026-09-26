// All plan coordinates are in meters. x grows to the right, y grows "down" the screen.
// In 3D, plan (x, y) maps to world (x, z) and heights go along world y.

export interface Vec2 {
  x: number;
  y: number;
}

export interface Wall {
  id: string;
  a: Vec2;
  b: Vec2;
  thickness: number;
  height: number;
}

/**
 * `terraceDoor` is a glazed door out to a balcony or terrace.
 * `tallWindow` is a floor-to-ceiling window (fixed glass, no sill).
 */
export type OpeningKind = 'door' | 'terraceDoor' | 'window' | 'tallWindow';

export const OPENING_KINDS: OpeningKind[] = ['door', 'terraceDoor', 'window', 'tallWindow'];

export const OPENING_LABELS: Record<OpeningKind, string> = {
  door: 'Door',
  terraceDoor: 'Terrace door',
  window: 'Window',
  tallWindow: 'Floor-to-ceiling window',
};

/** Doors have a leaf that swings; windows are fixed glass. */
export const isDoor = (kind: OpeningKind) => kind === 'door' || kind === 'terraceDoor';

export interface Opening {
  id: string;
  wallId: string;
  kind: OpeningKind;
  /** Distance from wall.a to the opening's center, along the wall. */
  offset: number;
  width: number;
  height: number;
  /** Height of the bottom edge above the floor (0 for doors and floor-to-ceiling windows). */
  sill: number;
  /** Doors only: hinge at the "b" end instead of the "a" end. */
  flipHinge: boolean;
  /** Doors only: swing to the other side of the wall. */
  flipSwing: boolean;
}

export interface Furniture {
  id: string;
  name: string;
  /** Center of the box on the plan. */
  x: number;
  y: number;
  /** Size along the box's local x axis (plan). */
  width: number;
  /** Size along the box's local y axis (plan). */
  length: number;
  height: number;
  /** Height of the box bottom above the floor. */
  elevation: number;
  /** Degrees, clockwise on the plan. */
  rotation: number;
  color: string;
}

export interface Plan {
  version: 1;
  walls: Wall[];
  openings: Opening[];
  furniture: Furniture[];
}

export type Selection =
  | { kind: 'wall'; id: string }
  | { kind: 'opening'; id: string }
  | { kind: 'furniture'; id: string }
  | null;

export const DEFAULTS = {
  wallThickness: 0.2,
  wallHeight: 2.7,
  door: { width: 0.9, height: 2.1, sill: 0 },
  terraceDoor: { width: 0.9, height: 2.2, sill: 0 },
  window: { width: 1.2, height: 1.2, sill: 0.9 },
  tallWindow: { width: 1.2, height: 2.2, sill: 0 },
  furniture: { width: 1, length: 1, height: 0.8 },
};

export function emptyPlan(): Plan {
  return { version: 1, walls: [], openings: [], furniture: [] };
}

let counter = 0;
export function newId(prefix: string): string {
  counter++;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Best-effort validation of loaded JSON; fills in missing fields with defaults. */
export function normalizePlan(raw: unknown): Plan {
  const src = (raw ?? {}) as Partial<Plan>;
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const walls: Wall[] = (Array.isArray(src.walls) ? src.walls : []).map((w) => ({
    id: String(w.id ?? newId('w')),
    a: { x: num(w.a?.x, 0), y: num(w.a?.y, 0) },
    b: { x: num(w.b?.x, 0), y: num(w.b?.y, 0) },
    thickness: num(w.thickness, DEFAULTS.wallThickness),
    height: num(w.height, DEFAULTS.wallHeight),
  }));
  const wallIds = new Set(walls.map((w) => w.id));
  const openings: Opening[] = (Array.isArray(src.openings) ? src.openings : [])
    .filter((o) => wallIds.has(o.wallId))
    .map((o) => {
      const kind: OpeningKind = OPENING_KINDS.includes(o.kind) ? o.kind : 'door';
      const d = DEFAULTS[kind];
      return {
        id: String(o.id ?? newId('o')),
        wallId: o.wallId,
        kind,
        offset: num(o.offset, 0),
        width: num(o.width, d.width),
        height: num(o.height, d.height),
        sill: num(o.sill, d.sill),
        flipHinge: !!o.flipHinge,
        flipSwing: !!o.flipSwing,
      };
    });
  const furniture: Furniture[] = (Array.isArray(src.furniture) ? src.furniture : []).map((f) => ({
    id: String(f.id ?? newId('f')),
    name: String(f.name ?? 'Box'),
    x: num(f.x, 0),
    y: num(f.y, 0),
    width: num(f.width, DEFAULTS.furniture.width),
    length: num(f.length, DEFAULTS.furniture.length),
    height: num(f.height, DEFAULTS.furniture.height),
    elevation: num(f.elevation, 0),
    rotation: num(f.rotation, 0),
    color: typeof f.color === 'string' ? f.color : '#c8a27a',
  }));
  return { version: 1, walls, openings, furniture };
}
