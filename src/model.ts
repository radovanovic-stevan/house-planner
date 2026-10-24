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

/** What a piece of furniture looks like. `box` is a plain block. The front faces local +y on the plan. */
export type FurnitureKind =
  | 'sofa'
  | 'armchair'
  | 'bed'
  | 'nightstand'
  | 'diningTable'
  | 'coffeeTable'
  | 'chair'
  | 'desk'
  | 'wardrobe'
  | 'bookshelf'
  | 'tvUnit'
  | 'kitchenCounter'
  | 'fridge'
  | 'toilet'
  | 'bathtub'
  | 'shower'
  | 'washbasin'
  | 'rug'
  | 'plant'
  | 'floorLamp'
  | 'box';

interface FurnitureSpec {
  label: string;
  width: number;
  length: number;
  height: number;
  color: string;
}

export const FURNITURE: Record<FurnitureKind, FurnitureSpec> = {
  sofa: { label: 'Sofa', width: 2.2, length: 0.9, height: 0.85, color: '#7d8fa6' },
  armchair: { label: 'Armchair', width: 0.85, length: 0.85, height: 0.85, color: '#9a8478' },
  bed: { label: 'Bed', width: 1.6, length: 2.1, height: 1, color: '#c9d3dc' },
  nightstand: { label: 'Nightstand', width: 0.45, length: 0.4, height: 0.55, color: '#a0785a' },
  diningTable: { label: 'Dining table', width: 1.6, length: 0.9, height: 0.75, color: '#a0785a' },
  coffeeTable: { label: 'Coffee table', width: 1.1, length: 0.6, height: 0.42, color: '#a0785a' },
  chair: { label: 'Chair', width: 0.45, length: 0.5, height: 0.9, color: '#8c6d53' },
  desk: { label: 'Desk', width: 1.4, length: 0.7, height: 0.75, color: '#d8c7aa' },
  wardrobe: { label: 'Wardrobe', width: 1.8, length: 0.6, height: 2.1, color: '#8c6d53' },
  bookshelf: { label: 'Bookshelf', width: 0.9, length: 0.35, height: 1.9, color: '#b08b67' },
  tvUnit: { label: 'TV unit', width: 1.8, length: 0.45, height: 1.2, color: '#5d534a' },
  kitchenCounter: { label: 'Kitchen counter', width: 2.4, length: 0.6, height: 0.9, color: '#e8e4da' },
  fridge: { label: 'Fridge', width: 0.6, length: 0.65, height: 1.85, color: '#eceeef' },
  toilet: { label: 'Toilet', width: 0.4, length: 0.65, height: 0.8, color: '#f7f7f5' },
  bathtub: { label: 'Bathtub', width: 1.7, length: 0.75, height: 0.55, color: '#f7f7f5' },
  shower: { label: 'Shower', width: 0.9, length: 0.9, height: 2, color: '#f7f7f5' },
  washbasin: { label: 'Washbasin', width: 0.6, length: 0.45, height: 0.85, color: '#8c6d53' },
  rug: { label: 'Rug', width: 2, length: 1.4, height: 0.01, color: '#b9a48a' },
  plant: { label: 'Plant', width: 0.5, length: 0.5, height: 1.2, color: '#b5653e' },
  floorLamp: { label: 'Floor lamp', width: 0.4, length: 0.4, height: 1.6, color: '#efe6d2' },
  box: { label: 'Box', width: 1, length: 1, height: 0.8, color: '#c8a27a' },
};

export const FURNITURE_KINDS = Object.keys(FURNITURE) as FurnitureKind[];

/** Picks a kind from a name, for plans saved before furniture had kinds (e.g. "Sofa", "Kitchen counter"). */
export function guessFurnitureKind(name: string): FurnitureKind {
  const n = name.toLowerCase();
  const words: [string, FurnitureKind][] = [
    ['coffee', 'coffeeTable'],
    ['night', 'nightstand'],
    ['bedside', 'nightstand'],
    ['armchair', 'armchair'],
    ['sofa', 'sofa'],
    ['couch', 'sofa'],
    ['bed', 'bed'],
    ['table', 'diningTable'],
    ['chair', 'chair'],
    ['desk', 'desk'],
    ['wardrobe', 'wardrobe'],
    ['closet', 'wardrobe'],
    ['shel', 'bookshelf'],
    ['tv', 'tvUnit'],
    ['counter', 'kitchenCounter'],
    ['kitchen', 'kitchenCounter'],
    ['fridge', 'fridge'],
    ['toilet', 'toilet'],
    ['wc', 'toilet'],
    ['bath', 'bathtub'],
    ['tub', 'bathtub'],
    ['shower', 'shower'],
    ['sink', 'washbasin'],
    ['basin', 'washbasin'],
    ['rug', 'rug'],
    ['carpet', 'rug'],
    ['plant', 'plant'],
    ['lamp', 'floorLamp'],
  ];
  return words.find(([w]) => n.includes(w))?.[1] ?? 'box';
}

export interface Furniture {
  id: string;
  kind: FurnitureKind;
  name: string;
  /** Center of the piece on the plan. */
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

/** `tiles` marks a tiled floor inside a room, such as a kitchen; the others are outdoor. */
export type AreaKind = 'terrace' | 'balcony' | 'tiles';

export const AREA_LABELS: Record<AreaKind, string> = { terrace: 'Terrace', balcony: 'Balcony', tiles: 'Tiled floor' };

export const isOutdoor = (kind: AreaKind) => kind !== 'tiles';

/** A floor area such as a terrace, a balcony or a tiled kitchen floor: an axis-aligned rectangle on the plan. */
export interface Area {
  id: string;
  kind: AreaKind;
  /** Top-left corner on the plan. */
  x: number;
  y: number;
  /** Size along plan x. */
  width: number;
  /** Size along plan y. */
  length: number;
}

export interface Plan {
  version: 1;
  walls: Wall[];
  openings: Opening[];
  furniture: Furniture[];
  areas: Area[];
}

export type Selection =
  | { kind: 'wall'; id: string }
  | { kind: 'opening'; id: string }
  | { kind: 'furniture'; id: string }
  | { kind: 'area'; id: string }
  | null;

export const DEFAULTS = {
  wallThickness: 0.2,
  wallHeight: 2.7,
  door: { width: 0.9, height: 2.1, sill: 0 },
  terraceDoor: { width: 0.9, height: 2.2, sill: 0 },
  window: { width: 1.2, height: 1.2, sill: 0.9 },
  tallWindow: { width: 1.2, height: 2.2, sill: 0 },
};

export function emptyPlan(): Plan {
  return { version: 1, walls: [], openings: [], furniture: [], areas: [] };
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
  const furniture: Furniture[] = (Array.isArray(src.furniture) ? src.furniture : []).map((f) => {
    const name = String(f.name ?? 'Box');
    const kind: FurnitureKind = FURNITURE_KINDS.includes(f.kind) ? f.kind : guessFurnitureKind(name);
    const d = FURNITURE[kind];
    return {
      id: String(f.id ?? newId('f')),
      kind,
      name,
      x: num(f.x, 0),
      y: num(f.y, 0),
      width: num(f.width, d.width),
      length: num(f.length, d.length),
      height: num(f.height, d.height),
      elevation: num(f.elevation, 0),
      rotation: num(f.rotation, 0),
      color: typeof f.color === 'string' ? f.color : d.color,
    };
  });
  const areas: Area[] = (Array.isArray(src.areas) ? src.areas : []).map((a) => ({
    id: String(a.id ?? newId('a')),
    kind: a.kind === 'balcony' || a.kind === 'tiles' ? a.kind : 'terrace',
    x: num(a.x, 0),
    y: num(a.y, 0),
    width: Math.max(0.1, num(a.width, 1)),
    length: Math.max(0.1, num(a.length, 1)),
  }));
  return { version: 1, walls, openings, furniture, areas };
}

/** A new piece of the given kind at its default size, centered at a plan point. */
export function newFurniture(kind: FurnitureKind, at: Vec2, existing: Furniture[]): Furniture {
  const { label, width, length, height, color } = FURNITURE[kind];
  const same = existing.filter((f) => f.kind === kind).length;
  return {
    id: newId('f'),
    kind,
    name: same ? `${label} ${same + 1}` : label,
    x: at.x,
    y: at.y,
    width,
    length,
    height,
    elevation: 0,
    rotation: 0,
    color,
  };
}
