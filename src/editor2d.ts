import {
  add,
  dist,
  dot,
  fmt,
  normalize,
  perp,
  pointInPolygon,
  projectOnSegment,
  rectCorners,
  scale,
  snapAngle,
  snapToGrid,
  sub,
  wallDir,
  wallLength,
} from './geometry';
import { DEFAULTS, newId, type Furniture, type Opening, type OpeningKind, type Vec2, type Wall } from './model';
import {
  addWall,
  clampOpening,
  collinearRun,
  clampOpeningsOnWall,
  endpointsAt,
  getWall,
  healWalls,
  wallAt,
  wallEndExtensions,
  type EndpointRef,
} from './ops';
import { findRooms } from './rooms';
import type { Store } from './store';

const COLORS = {
  bg: '#f4f3ef',
  gridMinor: '#e6e4de',
  gridMajor: '#d3d0c8',
  axis: '#bdb9ae',
  wall: '#2b2b2e',
  wallSelected: '#2f6fed',
  room: '#fbfaf7',
  roomText: '#6b6860',
  dim: '#8a867c',
  opening: '#2b2b2e',
  accent: '#2f6fed',
  preview: '#2f6fed',
  invalid: '#d64545',
};

type Drag =
  | { kind: 'pan'; start: Vec2; origin: Vec2 }
  | { kind: 'endpoint'; refs: EndpointRef[]; moved: boolean }
  | { kind: 'wall'; refs: EndpointRef[]; normal: Vec2; startWorld: Vec2; startPositions: Vec2[]; moved: boolean }
  | { kind: 'opening'; id: string; moved: boolean }
  | { kind: 'furniture'; id: string; offset: Vec2; moved: boolean };

type Hit =
  | { kind: 'endpoint'; point: Vec2 }
  | { kind: 'opening'; opening: Opening }
  | { kind: 'furniture'; furniture: Furniture }
  | { kind: 'wall'; wall: Wall }
  | null;

export class Editor2D {
  private ctx: CanvasRenderingContext2D;
  /** Pixels per meter. */
  private zoom = 60;
  /** Screen position (css px) of world origin. */
  private origin: Vec2 = { x: 200, y: 150 };
  private cursor: Vec2 | null = null; // world, raw
  private shift = false;
  private spaceDown = false;
  private drag: Drag | null = null;
  private chain: { start: Vec2; last: Vec2 } | null = null;
  private typedLength = '';
  private hover: Hit = null;
  private frame = 0;
  private width = 0;
  private height = 0;
  onStatus: (text: string) => void = () => {};

  constructor(
    private canvas: HTMLCanvasElement,
    private store: Store,
  ) {
    this.ctx = canvas.getContext('2d')!;
    new ResizeObserver(() => this.resize()).observe(canvas);
    canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    canvas.addEventListener('pointermove', (e) => this.onPointerMove(e));
    canvas.addEventListener('pointerup', (e) => this.onPointerUp(e));
    canvas.addEventListener('pointerleave', () => {
      this.cursor = null;
      this.hover = null;
      this.requestRender();
    });
    canvas.addEventListener('dblclick', () => this.endChain());
    canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.endChain();
    });
    canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    store.subscribe(() => {
      if (store.ui.tool !== 'wall') this.endChain(false);
      // hover may point at objects replaced by undo/redo; recomputed on the next pointer move
      if (!this.drag) this.hover = null;
      this.requestRender();
    });
    this.resize();
  }

  get active() {
    return this.store.ui.view === '2d';
  }

  // ---------- coordinates ----------

  private toWorld(s: Vec2): Vec2 {
    return { x: (s.x - this.origin.x) / this.zoom, y: (s.y - this.origin.y) / this.zoom };
  }
  private toScreen(w: Vec2): Vec2 {
    return { x: this.origin.x + w.x * this.zoom, y: this.origin.y + w.y * this.zoom };
  }
  private eventScreen(e: MouseEvent): Vec2 {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  /** Tolerance in meters corresponding to `px` screen pixels. */
  private px(px: number) {
    return px / this.zoom;
  }

  private resize() {
    const r = this.canvas.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    const first = this.width === 0;
    this.width = r.width;
    this.height = r.height;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    if (first) this.zoomToFit();
    this.render();
  }

  zoomToFit() {
    const pts = [
      ...this.store.plan.walls.flatMap((w) => [w.a, w.b]),
      ...this.store.plan.furniture.flatMap((f) => rectCorners(f.x, f.y, f.width, f.length, f.rotation)),
    ];
    if (!pts.length || !this.width) {
      this.zoom = 60;
      this.origin = { x: this.width / 2 - 5 * this.zoom, y: this.height / 2 - 4 * this.zoom };
      this.requestRender();
      return;
    }
    const minX = Math.min(...pts.map((p) => p.x));
    const maxX = Math.max(...pts.map((p) => p.x));
    const minY = Math.min(...pts.map((p) => p.y));
    const maxY = Math.max(...pts.map((p) => p.y));
    const pad = 80;
    this.zoom = Math.max(8, Math.min(300, Math.min((this.width - pad * 2) / Math.max(1, maxX - minX), (this.height - pad * 2) / Math.max(1, maxY - minY))));
    this.origin = {
      x: this.width / 2 - ((minX + maxX) / 2) * this.zoom,
      y: this.height / 2 - ((minY + maxY) / 2) * this.zoom,
    };
    this.requestRender();
  }

  zoomBy(factor: number, around?: Vec2) {
    const c = around ?? { x: this.width / 2, y: this.height / 2 };
    const before = this.toWorld(c);
    this.zoom = Math.max(5, Math.min(600, this.zoom * factor));
    this.origin = { x: c.x - before.x * this.zoom, y: c.y - before.y * this.zoom };
    this.requestRender();
  }

  // ---------- snapping ----------

  /** Snaps a raw world point: existing wall endpoints win, then grid; Shift constrains angle. */
  private snapPoint(raw: Vec2, from?: Vec2): { p: Vec2; onEndpoint: boolean } {
    const tol = this.px(10);
    let best: Vec2 | null = null;
    let bestD = tol;
    for (const w of this.store.plan.walls) {
      for (const e of [w.a, w.b]) {
        const d = dist(e, raw);
        if (d < bestD) {
          bestD = d;
          best = e;
        }
      }
    }
    if (best && !(from && this.shift)) return { p: { ...best }, onEndpoint: true };
    let p = snapToGrid(raw, this.store.ui.snap);
    if (from && this.shift) {
      p = snapAngle(from, raw, 45);
      // keep the length on the grid step
      const step = this.store.ui.snap;
      if (step > 0) {
        const l = dist(from, p);
        const d = normalize(sub(p, from));
        p = add(from, scale(d, Math.round(l / step) * step));
      }
    }
    return { p, onEndpoint: false };
  }

  private snapScalar(v: number) {
    const s = this.store.ui.snap;
    return s > 0 ? Math.round(v / s) * s : v;
  }

  // ---------- hit testing ----------

  private hitTest(p: Vec2): Hit {
    const plan = this.store.plan;
    const tol = this.px(8);
    for (const w of plan.walls) {
      for (const e of [w.a, w.b]) if (dist(e, p) < tol) return { kind: 'endpoint', point: { ...e } };
    }
    for (const o of plan.openings) {
      const w = getWall(plan, o.wallId);
      if (!w) continue;
      const pr = projectOnSegment(p, w.a, w.b);
      if (pr.dist <= w.thickness / 2 + tol && Math.abs(pr.along - o.offset) <= o.width / 2) return { kind: 'opening', opening: o };
    }
    for (let i = plan.furniture.length - 1; i >= 0; i--) {
      const f = plan.furniture[i];
      if (pointInPolygon(p, rectCorners(f.x, f.y, f.width, f.length, f.rotation))) return { kind: 'furniture', furniture: f };
    }
    const w = wallAt(plan, p, this.px(4));
    if (w) return { kind: 'wall', wall: w.wall };
    return null;
  }

  // ---------- input ----------

  private onWheel(e: WheelEvent) {
    e.preventDefault();
    const s = this.eventScreen(e);
    // Pinch on trackpads arrives as ctrl+wheel with small deltas; mouse wheels have larger ones.
    const k = e.ctrlKey ? 0.01 : 0.0015;
    this.zoomBy(Math.exp(-e.deltaY * k), s);
  }

  private onPointerDown(e: PointerEvent) {
    const s = this.eventScreen(e);
    const p = this.toWorld(s);
    this.canvas.setPointerCapture(e.pointerId);
    this.canvas.focus();

    if (e.button === 1 || (e.button === 0 && this.spaceDown)) {
      this.drag = { kind: 'pan', start: s, origin: { ...this.origin } };
      return;
    }
    if (e.button !== 0) return;

    const tool = this.store.ui.tool;
    if (tool === 'wall') return this.wallClick(p);
    if (tool === 'door' || tool === 'window') return this.placeOpening(tool, p);
    if (tool === 'furniture') return this.placeFurniture(p);

    // select tool
    const hit = this.hitTest(p);
    const store = this.store;
    if (!hit) {
      store.select(null);
      this.drag = { kind: 'pan', start: s, origin: { ...this.origin } };
      return;
    }
    store.checkpoint();
    if (hit.kind === 'endpoint') {
      const refs = endpointsAt(store.plan, hit.point);
      this.drag = { kind: 'endpoint', refs, moved: false };
      const sel = store.selection;
      if (!(sel?.kind === 'wall' && refs.some((r) => r.wallId === sel.id))) store.select({ kind: 'wall', id: refs[0].wallId });
    } else if (hit.kind === 'wall') {
      // Move the whole straight run of wall, perpendicular to itself; joined walls stretch.
      const run = collinearRun(store.plan, hit.wall);
      const seen = new Set<string>();
      const refs: EndpointRef[] = [];
      for (const w of run) {
        for (const p of [w.a, w.b]) {
          for (const r of endpointsAt(store.plan, p)) {
            const k = `${r.wallId}:${r.end}`;
            if (!seen.has(k)) {
              seen.add(k);
              refs.push(r);
            }
          }
        }
      }
      this.drag = {
        kind: 'wall',
        refs,
        normal: perp(wallDir(hit.wall)),
        startWorld: p,
        startPositions: refs.map((r) => ({ ...getWall(store.plan, r.wallId)![r.end] })),
        moved: false,
      };
      store.select({ kind: 'wall', id: hit.wall.id });
    } else if (hit.kind === 'opening') {
      this.drag = { kind: 'opening', id: hit.opening.id, moved: false };
      store.select({ kind: 'opening', id: hit.opening.id });
    } else {
      const f = hit.furniture;
      this.drag = { kind: 'furniture', id: f.id, offset: { x: f.x - p.x, y: f.y - p.y }, moved: false };
      store.select({ kind: 'furniture', id: f.id });
    }
  }

  private onPointerMove(e: PointerEvent) {
    const s = this.eventScreen(e);
    const p = this.toWorld(s);
    this.cursor = p;
    this.shift = e.shiftKey;
    const plan = this.store.plan;
    const d = this.drag;

    if (d?.kind === 'pan') {
      this.origin = { x: d.origin.x + s.x - d.start.x, y: d.origin.y + s.y - d.start.y };
    } else if (d?.kind === 'endpoint') {
      const others = d.refs.map((r) => getWall(plan, r.wallId)!);
      // snap to endpoints of walls not being dragged
      const q = this.snapPointExcluding(p, new Set(others.map((w) => w.id)));
      for (const r of d.refs) getWall(plan, r.wallId)![r.end] = { ...q };
      for (const w of others) clampOpeningsOnWall(plan, w.id);
      d.moved = true;
      this.store.emit();
    } else if (d?.kind === 'wall') {
      const amount = this.snapScalar(dot(sub(p, d.startWorld), d.normal));
      const sd = scale(d.normal, amount);
      d.refs.forEach((r, i) => {
        getWall(plan, r.wallId)![r.end] = add(d.startPositions[i], sd);
      });
      for (const r of d.refs) clampOpeningsOnWall(plan, r.wallId);
      d.moved = true;
      this.store.emit();
    } else if (d?.kind === 'opening') {
      const o = plan.openings.find((x) => x.id === d.id);
      const hit = wallAt(plan, p, this.px(30));
      if (o && hit) {
        o.wallId = hit.wall.id;
        o.offset = this.snapScalar(hit.along);
        clampOpening(plan, o);
        d.moved = true;
        this.store.emit();
      }
    } else if (d?.kind === 'furniture') {
      const f = plan.furniture.find((x) => x.id === d.id);
      if (f) {
        const q = snapToGrid(add(p, d.offset), this.store.ui.snap);
        f.x = q.x;
        f.y = q.y;
        d.moved = true;
        this.store.emit();
      }
    } else {
      this.hover = this.store.ui.tool === 'select' ? this.hitTest(p) : null;
    }
    this.updateCursorStyle();
    this.updateStatus();
    this.requestRender();
  }

  private snapPointExcluding(raw: Vec2, exclude: Set<string>): Vec2 {
    const tol = this.px(10);
    let best: Vec2 | null = null;
    let bestD = tol;
    for (const w of this.store.plan.walls) {
      if (exclude.has(w.id)) continue;
      for (const e of [w.a, w.b]) {
        const d = dist(e, raw);
        if (d < bestD) {
          bestD = d;
          best = e;
        }
      }
    }
    return best ? { ...best } : snapToGrid(raw, this.store.ui.snap);
  }

  private onPointerUp(e: PointerEvent) {
    this.canvas.releasePointerCapture(e.pointerId);
    const d = this.drag;
    this.drag = null;
    if (!d || d.kind === 'pan') return;
    if (!d.moved) {
      this.store.dropCheckpoint();
      return;
    }
    if (d.kind === 'endpoint' || d.kind === 'wall') {
      healWalls(this.store.plan);
      this.store.emit();
    }
  }

  private updateCursorStyle() {
    const tool = this.store.ui.tool;
    let c = 'crosshair';
    if (this.drag?.kind === 'pan') c = 'grabbing';
    else if (this.spaceDown) c = 'grab';
    else if (tool === 'select') c = this.hover ? 'move' : 'default';
    this.canvas.style.cursor = c;
  }

  /** Keyboard handling for the 2D editor. Returns true if the key was consumed. */
  handleKey(e: KeyboardEvent, down: boolean): boolean {
    if (e.key === ' ') {
      this.spaceDown = down;
      this.updateCursorStyle();
      return true;
    }
    if (e.key === 'Shift') {
      this.shift = down;
      this.requestRender();
      return false;
    }
    if (!down) return false;
    if (this.chain) {
      if (/^[0-9.,]$/.test(e.key)) {
        this.typedLength += e.key === ',' ? '.' : e.key;
        this.requestRender();
        return true;
      }
      if (e.key === 'Backspace' && this.typedLength) {
        this.typedLength = this.typedLength.slice(0, -1);
        this.requestRender();
        return true;
      }
      if (e.key === 'Enter') {
        if (this.typedLength) this.commitTypedLength();
        else this.endChain();
        return true;
      }
      if (e.key === 'Escape') {
        this.endChain();
        return true;
      }
    }
    return false;
  }

  // ---------- tools ----------

  private previewPoint(): Vec2 | null {
    if (!this.cursor) return null;
    const from = this.chain?.last;
    const { p } = this.snapPoint(this.cursor, from);
    if (from && this.typedLength) {
      const l = parseFloat(this.typedLength);
      const dir = normalize(sub(p, from));
      if (Number.isFinite(l) && l > 0 && (dir.x || dir.y)) return add(from, scale(dir, l));
    }
    return p;
  }

  private wallClick(raw: Vec2) {
    this.cursor = raw;
    const p = this.previewPoint();
    if (!p) return;
    if (!this.chain) {
      this.chain = { start: p, last: p };
      this.typedLength = '';
      this.requestRender();
      return;
    }
    this.addChainSegment(p);
  }

  private addChainSegment(p: Vec2) {
    if (!this.chain || dist(this.chain.last, p) < 0.01) return;
    const store = this.store;
    store.checkpoint();
    addWall(store.plan, this.chain.last, p);
    const closed = dist(p, this.chain.start) < 1e-3;
    this.chain.last = p;
    this.typedLength = '';
    if (closed) this.chain = null;
    store.emit();
  }

  private commitTypedLength() {
    const p = this.previewPoint();
    if (p) this.addChainSegment(p);
  }

  endChain(render = true) {
    if (!this.chain && !this.typedLength) return;
    this.chain = null;
    this.typedLength = '';
    if (render) this.requestRender();
  }

  private openingPreview(kind: OpeningKind, p: Vec2): { wall: Wall; offset: number; valid: boolean } | null {
    const hit = wallAt(this.store.plan, p, this.px(20));
    if (!hit) return null;
    const def = DEFAULTS[kind];
    const L = wallLength(hit.wall);
    const offset = Math.max(def.width / 2, Math.min(L - def.width / 2, this.snapScalar(hit.along)));
    return { wall: hit.wall, offset, valid: L >= def.width };
  }

  private placeOpening(kind: OpeningKind, p: Vec2) {
    const pv = this.openingPreview(kind, p);
    if (!pv || !pv.valid) return;
    const def = DEFAULTS[kind];
    const store = this.store;
    store.checkpoint();
    const o: Opening = {
      id: newId('o'),
      wallId: pv.wall.id,
      kind,
      offset: pv.offset,
      width: def.width,
      height: def.height,
      sill: def.sill,
      flipHinge: false,
      flipSwing: false,
    };
    store.plan.openings.push(o);
    store.selection = { kind: 'opening', id: o.id };
    store.emit();
  }

  private placeFurniture(p: Vec2) {
    const store = this.store;
    const q = snapToGrid(p, store.ui.snap);
    store.checkpoint();
    const f: Furniture = {
      id: newId('f'),
      name: `Box ${store.plan.furniture.length + 1}`,
      x: q.x,
      y: q.y,
      ...DEFAULTS.furniture,
      elevation: 0,
      rotation: 0,
      color: '#c8a27a',
    };
    store.plan.furniture.push(f);
    store.selection = { kind: 'furniture', id: f.id };
    store.ui.tool = 'select';
    store.emit();
  }

  // ---------- status ----------

  private updateStatus() {
    const parts: string[] = [];
    if (this.cursor) {
      const p = snapToGrid(this.cursor, this.store.ui.snap);
      parts.push(`x ${fmt(p.x)} m  y ${fmt(p.y)} m`);
    }
    if (this.chain && this.cursor) {
      const p = this.previewPoint();
      if (p) parts.push(`length ${fmt(dist(this.chain.last, p))} m`);
    }
    this.onStatus(parts.join('   ·   '));
  }

  // ---------- rendering ----------

  requestRender() {
    if (this.frame || !this.active) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.render();
    });
  }

  render() {
    if (!this.active || !this.width) return;
    const ctx = this.ctx;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, this.width, this.height);
    this.drawGrid();

    const plan = this.store.plan;
    const rooms = findRooms(plan);
    for (const r of rooms) {
      this.pathPoly(r.floor);
      ctx.fillStyle = COLORS.room;
      ctx.fill();
    }

    this.drawFurniture();
    this.drawWalls();
    this.drawOpenings();
    this.drawDimensions();

    ctx.font = '600 13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const r of rooms) {
      const c = this.toScreen(r.center);
      ctx.fillStyle = COLORS.roomText;
      ctx.fillText(`${fmt(r.area)} m²`, c.x, c.y);
    }

    this.drawToolOverlay();
    this.drawScaleBar();
  }

  private pathPoly(pts: Vec2[]) {
    const ctx = this.ctx;
    ctx.beginPath();
    pts.forEach((p, i) => {
      const s = this.toScreen(p);
      if (i === 0) ctx.moveTo(s.x, s.y);
      else ctx.lineTo(s.x, s.y);
    });
    ctx.closePath();
  }

  private drawGrid() {
    const ctx = this.ctx;
    const tl = this.toWorld({ x: 0, y: 0 });
    const br = this.toWorld({ x: this.width, y: this.height });
    const levels: [number, string][] = [
      [0.1, COLORS.gridMinor],
      [0.5, COLORS.gridMinor],
      [1, COLORS.gridMajor],
      [5, COLORS.axis],
    ];
    ctx.lineWidth = 1;
    for (const [step, color] of levels) {
      if (step * this.zoom < 10) continue;
      ctx.strokeStyle = color;
      ctx.beginPath();
      for (let x = Math.floor(tl.x / step) * step; x <= br.x; x += step) {
        const sx = Math.round(this.toScreen({ x, y: 0 }).x) + 0.5;
        ctx.moveTo(sx, 0);
        ctx.lineTo(sx, this.height);
      }
      for (let y = Math.floor(tl.y / step) * step; y <= br.y; y += step) {
        const sy = Math.round(this.toScreen({ x: 0, y }).y) + 0.5;
        ctx.moveTo(0, sy);
        ctx.lineTo(this.width, sy);
      }
      ctx.stroke();
    }
  }

  private wallPolygon(w: Wall, ext: { a: number; b: number }): Vec2[] {
    const d = wallDir(w);
    const n = scale(perp(d), w.thickness / 2);
    const a = sub(w.a, scale(d, ext.a));
    const b = add(w.b, scale(d, ext.b));
    return [add(a, n), add(b, n), sub(b, n), sub(a, n)];
  }

  private drawWalls() {
    const ctx = this.ctx;
    const plan = this.store.plan;
    const exts = wallEndExtensions(plan);
    const sel = this.store.selection;
    ctx.beginPath();
    for (const w of plan.walls) {
      const poly = this.wallPolygon(w, exts.get(w.id)!).map((p) => this.toScreen(p));
      ctx.moveTo(poly[0].x, poly[0].y);
      for (const p of poly.slice(1)) ctx.lineTo(p.x, p.y);
      ctx.closePath();
    }
    ctx.fillStyle = COLORS.wall;
    ctx.fill('nonzero');

    const highlight = (w: Wall, color: string) => {
      this.pathPoly(this.wallPolygon(w, exts.get(w.id)!));
      ctx.fillStyle = color;
      ctx.fill();
    };
    if (this.hover?.kind === 'wall') highlight(this.hover.wall, '#4a4a55');
    if (sel?.kind === 'wall') {
      const w = getWall(plan, sel.id);
      if (w) {
        highlight(w, COLORS.wallSelected);
        for (const e of [w.a, w.b]) this.drawHandle(e);
      }
    }
    if (this.hover?.kind === 'endpoint') this.drawHandle(this.hover.point, true);
  }

  private drawHandle(p: Vec2, hover = false) {
    const ctx = this.ctx;
    const s = this.toScreen(p);
    ctx.beginPath();
    ctx.arc(s.x, s.y, hover ? 6 : 5, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = COLORS.accent;
    ctx.stroke();
  }

  private drawOpenings() {
    const plan = this.store.plan;
    const sel = this.store.selection;
    for (const o of plan.openings) {
      const w = getWall(plan, o.wallId);
      if (!w) continue;
      const color = sel?.kind === 'opening' && sel.id === o.id ? COLORS.accent : this.hover?.kind === 'opening' && this.hover.opening.id === o.id ? '#555' : COLORS.opening;
      this.drawOpening(w, o.kind, o.offset, o.width, o.flipHinge, o.flipSwing, color);
    }
  }

  private drawOpening(w: Wall, kind: OpeningKind, offset: number, width: number, flipHinge: boolean, flipSwing: boolean, color: string, alpha = 1) {
    const ctx = this.ctx;
    const d = wallDir(w);
    const n = perp(d);
    const t = w.thickness / 2;
    const c0 = add(w.a, scale(d, offset - width / 2));
    const c1 = add(w.a, scale(d, offset + width / 2));
    ctx.save();
    ctx.globalAlpha = alpha;
    // cut the gap out of the wall
    const pad = this.px(1);
    this.pathPoly([add(c0, scale(n, t + pad)), add(c1, scale(n, t + pad)), sub(c1, scale(n, t + pad)), sub(c0, scale(n, t + pad))]);
    ctx.fillStyle = COLORS.room;
    ctx.fill();

    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    const line = (a: Vec2, b: Vec2) => {
      const sa = this.toScreen(a);
      const sb = this.toScreen(b);
      ctx.beginPath();
      ctx.moveTo(sa.x, sa.y);
      ctx.lineTo(sb.x, sb.y);
      ctx.stroke();
    };
    // jambs
    line(add(c0, scale(n, t)), sub(c0, scale(n, t)));
    line(add(c1, scale(n, t)), sub(c1, scale(n, t)));

    if (kind === 'window') {
      line(add(c0, scale(n, t)), add(c1, scale(n, t)));
      line(sub(c0, scale(n, t)), sub(c1, scale(n, t)));
      ctx.lineWidth = 1;
      line(c0, c1);
    } else {
      const hinge = flipHinge ? c1 : c0;
      const other = flipHinge ? c0 : c1;
      const side = flipSwing ? -1 : 1;
      const hingeFace = add(hinge, scale(n, t * side));
      const leafEnd = add(hingeFace, scale(n, width * side));
      line(hingeFace, leafEnd);
      // swing arc from the open leaf back to the closed position
      const hs = this.toScreen(hingeFace);
      const a0 = Math.atan2(leafEnd.y - hingeFace.y, leafEnd.x - hingeFace.x);
      const closed = add(other, scale(n, t * side));
      const a1 = Math.atan2(closed.y - hingeFace.y, closed.x - hingeFace.x);
      let delta = a1 - a0;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.arc(hs.x, hs.y, width * this.zoom, a0, a0 + delta, delta < 0);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  }

  private drawFurniture() {
    const ctx = this.ctx;
    const sel = this.store.selection;
    for (const f of this.store.plan.furniture) {
      const corners = rectCorners(f.x, f.y, f.width, f.length, f.rotation);
      this.pathPoly(corners);
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = f.color;
      ctx.fill();
      ctx.globalAlpha = 1;
      const selected = sel?.kind === 'furniture' && sel.id === f.id;
      const hovered = this.hover?.kind === 'furniture' && this.hover.furniture.id === f.id;
      ctx.lineWidth = selected ? 2 : 1;
      ctx.strokeStyle = selected ? COLORS.accent : hovered ? '#555' : '#7a6a58';
      ctx.stroke();
      // front edge marker so rotation is visible
      const s0 = this.toScreen(corners[2]);
      const s1 = this.toScreen(corners[3]);
      ctx.lineWidth = selected ? 3 : 2;
      ctx.beginPath();
      ctx.moveTo(s0.x, s0.y);
      ctx.lineTo(s1.x, s1.y);
      ctx.stroke();
      const c = this.toScreen({ x: f.x, y: f.y });
      const minSide = Math.min(f.width, f.length) * this.zoom;
      if (minSide > 24) {
        ctx.fillStyle = '#3d3528';
        ctx.font = '11px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(f.name, c.x, c.y - 7);
        ctx.fillStyle = '#6d6252';
        ctx.fillText(`${fmt(f.width)}×${fmt(f.length)}×${fmt(f.height)}`, c.x, c.y + 7);
      }
    }
  }

  private drawDimensions() {
    if (this.zoom < 20) return;
    const ctx = this.ctx;
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const w of this.store.plan.walls) {
      const L = wallLength(w);
      if (L * this.zoom < 30) continue;
      const d = wallDir(w);
      const n = perp(d);
      const mid = scale(add(w.a, w.b), 0.5);
      const pos = this.toScreen(add(mid, scale(n, w.thickness / 2 + this.px(9))));
      let ang = Math.atan2(d.y, d.x);
      if (ang > Math.PI / 2) ang -= Math.PI;
      if (ang <= -Math.PI / 2) ang += Math.PI;
      ctx.save();
      ctx.translate(pos.x, pos.y);
      ctx.rotate(ang);
      ctx.fillStyle = COLORS.dim;
      ctx.fillText(`${fmt(L)} m`, 0, 0);
      ctx.restore();
    }
  }

  private drawToolOverlay() {
    const ctx = this.ctx;
    const tool = this.store.ui.tool;
    if (!this.cursor || this.drag?.kind === 'pan') return;

    if (tool === 'wall') {
      const p = this.previewPoint();
      if (!p) return;
      const snapped = this.snapPoint(this.cursor, this.chain?.last);
      const sp = this.toScreen(p);
      if (this.chain) {
        const from = this.chain.last;
        const sf = this.toScreen(from);
        const tpx = DEFAULTS.wallThickness * this.zoom;
        ctx.save();
        ctx.globalAlpha = 0.35;
        ctx.strokeStyle = COLORS.preview;
        ctx.lineWidth = tpx;
        ctx.lineCap = 'butt';
        ctx.beginPath();
        ctx.moveTo(sf.x, sf.y);
        ctx.lineTo(sp.x, sp.y);
        ctx.stroke();
        ctx.restore();
        ctx.strokeStyle = COLORS.preview;
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.moveTo(sf.x, sf.y);
        ctx.lineTo(sp.x, sp.y);
        ctx.stroke();
        ctx.setLineDash([]);
        const L = dist(from, p);
        const label = this.typedLength ? `${this.typedLength}▏m` : `${fmt(L)} m`;
        this.drawTag(label, { x: (sf.x + sp.x) / 2, y: (sf.y + sp.y) / 2 - 16 });
        // show the chain start so closing the loop is easy
        const ss = this.toScreen(this.chain.start);
        ctx.beginPath();
        ctx.arc(ss.x, ss.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = COLORS.preview;
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, snapped.onEndpoint ? 7 : 4, 0, Math.PI * 2);
      ctx.strokeStyle = COLORS.preview;
      ctx.lineWidth = 2;
      ctx.stroke();
    } else if (tool === 'door' || tool === 'window') {
      const pv = this.openingPreview(tool, this.cursor);
      if (pv) {
        const def = DEFAULTS[tool];
        this.drawOpening(pv.wall, tool, pv.offset, def.width, false, false, pv.valid ? COLORS.preview : COLORS.invalid, 0.8);
      }
    } else if (tool === 'furniture') {
      const q = snapToGrid(this.cursor, this.store.ui.snap);
      const { width, length } = DEFAULTS.furniture;
      this.pathPoly(rectCorners(q.x, q.y, width, length, 0));
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = COLORS.preview;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  private drawTag(text: string, at: Vec2) {
    const ctx = this.ctx;
    ctx.font = '600 12px system-ui, sans-serif';
    const w = ctx.measureText(text).width + 12;
    ctx.fillStyle = COLORS.preview;
    ctx.beginPath();
    ctx.roundRect(at.x - w / 2, at.y - 10, w, 20, 4);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, at.x, at.y + 0.5);
  }

  private drawScaleBar() {
    const ctx = this.ctx;
    const candidates = [0.5, 1, 2, 5, 10, 20];
    const m = candidates.find((c) => c * this.zoom >= 60) ?? 20;
    const len = m * this.zoom;
    const x = 16;
    const y = this.height - 20;
    ctx.strokeStyle = '#555';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y - 5);
    ctx.lineTo(x, y);
    ctx.lineTo(x + len, y);
    ctx.lineTo(x + len, y - 5);
    ctx.stroke();
    ctx.fillStyle = '#555';
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`${m} m`, x + len / 2, y - 3);
  }
}
