import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { dist, pointInPolygon, rectCorners, snapToGrid, wallDir, wallLength } from './geometry';
import { DEFAULTS, isDoor, newId, type Furniture, type Opening, type Selection, type Vec2, type Wall } from './model';
import { wallEndExtensions } from './ops';
import { findRooms } from './rooms';
import type { Store } from './store';

const COLORS = {
  sky: 0xeef1f4,
  ground: 0xdfe3da,
  floor: 0xe9dfcf,
  wall: 0xf5f3ee,
  wallSelected: 0xbcd0fa,
  glass: 0x9ec3e6,
  door: 0xa47b56,
  frame: 0x5c6168,
  tile: 0xd9c9ae,
  accent: 0x2f6fed,
  edge: 0x3a3a3a,
};

/** Walls are cut down to this height in cutaway mode so the rooms are visible from above. */
const CUTAWAY_HEIGHT = 1.1;

type Pick = { kind: 'wall' | 'opening' | 'furniture' | 'area'; id: string };

type Drag = { id: string; offset: THREE.Vector2; moved: boolean };

/** Rectangle on the plan that the walker can't enter: center, unit axis along its length, half sizes. */
type Collider = { c: Vec2; u: Vec2; hu: number; hv: number };

const WALK = {
  eyeHeight: 1.6,
  radius: 0.22,
  speed: 1.5,
  runSpeed: 3.5,
  fov: 70,
  lookSensitivity: 0.0022,
};

/** Doors (terrace doors too) you can walk through; windows are solid, even floor-to-ceiling ones. */
const isPassable = (o: Opening) => isDoor(o.kind) && o.sill < 0.3 && o.sill + o.height > 1.8;

/** Furniture you bump into: something between your feet and your head. */
const blocksWalking = (f: Furniture) => f.elevation < WALK.eyeHeight && f.elevation + f.height > 0.25;

// plan (x, y) -> world (x, 0, y); plan rotation (clockwise degrees, y down) -> rotation about world Y
const planAngleToY = (deg: number) => -(deg * Math.PI) / 180;

export class View3D {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(50, 1, 0.05, 500);
  private controls: OrbitControls;
  private structure = new THREE.Group();
  private furnitureGroup = new THREE.Group();
  private sun: THREE.DirectionalLight;
  private ground: THREE.Mesh;
  private raycaster = new THREE.Raycaster();
  private floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private structureKey = '';
  private furnitureMeshes = new Map<string, THREE.Mesh>();
  private unitBox = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  private unitEdges = new THREE.EdgesGeometry(this.unitBox);
  private drag: Drag | null = null;
  private downAt: { x: number; y: number } | null = null;
  private placePreview: THREE.Mesh;
  private cutaway = false;
  private framed = false;
  private needsRender = true;
  private running = false;
  private colliders: Collider[] = [];
  private walk: {
    yaw: number;
    pitch: number;
    keys: Set<string>;
    last: number;
    saved: { position: THREE.Vector3; target: THREE.Vector3; cutaway: boolean };
  } | null = null;
  private walkHint!: HTMLElement;

  constructor(
    private container: HTMLElement,
    private store: Store,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.renderer.domElement.style.touchAction = 'none';
    container.append(this.renderer.domElement);
    this.buildOverlay();

    this.scene.background = new THREE.Color(COLORS.sky);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xb8b2a4, 1.6));
    this.sun = new THREE.DirectionalLight(0xffffff, 1.8);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun, this.sun.target);

    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: COLORS.ground, roughness: 1 }));
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = -0.01;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);
    this.scene.add(this.structure, this.furnitureGroup);

    this.placePreview = new THREE.Mesh(
      this.unitBox,
      new THREE.MeshBasicMaterial({ color: COLORS.accent, transparent: true, opacity: 0.25, depthWrite: false }),
    );
    this.placePreview.scale.set(DEFAULTS.furniture.width, DEFAULTS.furniture.height, DEFAULTS.furniture.length);
    this.placePreview.visible = false;
    this.scene.add(this.placePreview);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.02;
    this.controls.minDistance = 1;
    this.controls.maxDistance = 120;
    this.controls.addEventListener('change', () => (this.needsRender = true));

    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    el.addEventListener('pointermove', (e) => this.onPointerMove(e));
    el.addEventListener('pointerup', (e) => this.onPointerUp(e));
    el.addEventListener('dblclick', (e) => this.onDoubleClick(e));
    el.addEventListener('mousemove', (e) => this.onWalkLook(e));
    document.addEventListener('pointerlockchange', () => {
      if (this.walk && document.pointerLockElement !== el) this.exitWalk();
    });
    window.addEventListener('keydown', (e) => this.onWalkKey(e, true));
    window.addEventListener('keyup', (e) => this.onWalkKey(e, false));
    window.addEventListener('blur', () => this.walk?.keys.clear());
    el.addEventListener('pointerleave', () => {
      this.placePreview.visible = false;
      this.needsRender = true;
    });
    new ResizeObserver(() => this.resize()).observe(container);

    store.subscribe(() => this.sync());
    this.sync();
  }

  // ---------- overlay ----------

  private buildOverlay() {
    const bar = document.createElement('div');
    bar.className = 'overlay-3d';
    bar.innerHTML = `
      <button data-act="walk" title="Walk through the house at eye height (P), or double-click the floor to start there">Walk inside</button>
      <button data-act="cutaway" title="Cut walls down to see inside (C)">Cutaway walls</button>
      <button data-act="top" title="Look straight down">Top view</button>
      <button data-act="reset" title="Frame the whole house">Reset camera</button>`;
    bar.addEventListener('click', (e) => {
      const act = (e.target as HTMLElement).closest('button')?.dataset.act;
      if (act === 'walk') this.enterWalk();
      if (act === 'cutaway') this.toggleCutaway();
      if (act === 'top') this.frame(true);
      if (act === 'reset') this.frame(false);
    });
    this.walkHint = document.createElement('div');
    this.walkHint.className = 'walk-hint';
    this.walkHint.hidden = true;
    this.walkHint.innerHTML = `
      <div class="crosshair"></div>
      <div class="walk-keys"><b>WASD</b> or arrows to move · <b>mouse</b> to look · <b>Shift</b> to run · <b>Esc</b> to leave</div>`;
    this.container.append(bar, this.walkHint);
  }

  toggleCutaway() {
    this.cutaway = !this.cutaway;
    this.container.querySelector('[data-act="cutaway"]')!.classList.toggle('active', this.cutaway);
    this.structureKey = '';
    this.sync();
  }

  // ---------- lifecycle ----------

  private get active() {
    return this.store.ui.view === '3d';
  }

  private resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.needsRender = true;
  }

  private loop = () => {
    if (!this.active) {
      this.running = false;
      return;
    }
    requestAnimationFrame(this.loop);
    if (this.walk) this.stepWalk();
    else this.controls.update();
    if (this.needsRender) {
      this.needsRender = false;
      this.renderer.render(this.scene, this.camera);
    }
  };

  private sync() {
    if (!this.active) {
      if (this.walk) this.exitWalk();
      return;
    }
    this.resize();
    this.syncStructure();
    this.syncFurniture();
    if (!this.framed) {
      this.framed = true;
      this.frame(false);
    }
    this.placePreview.visible = this.placePreview.visible && this.store.ui.tool === 'furniture';
    this.needsRender = true;
    if (!this.running) {
      this.running = true;
      requestAnimationFrame(this.loop);
    }
  }

  private bounds(): THREE.Box3 {
    const box = new THREE.Box3();
    for (const w of this.store.plan.walls) {
      box.expandByPoint(new THREE.Vector3(w.a.x, 0, w.a.y));
      box.expandByPoint(new THREE.Vector3(w.b.x, w.height, w.b.y));
    }
    for (const f of this.store.plan.furniture) {
      for (const c of rectCorners(f.x, f.y, f.width, f.length, f.rotation)) box.expandByPoint(new THREE.Vector3(c.x, f.elevation + f.height, c.y));
    }
    if (box.isEmpty()) box.set(new THREE.Vector3(-3, 0, -3), new THREE.Vector3(3, 2.7, 3));
    return box;
  }

  /** Points the camera at the whole house, either at an angle or straight down. */
  frame(top: boolean) {
    const box = this.bounds();
    const center = box.getCenter(new THREE.Vector3());
    center.y = 0;
    const size = box.getSize(new THREE.Vector3());
    const r = Math.max(size.x, size.z, 4);
    this.controls.target.copy(center);
    if (top) this.camera.position.set(center.x, r * 1.6, center.z + 0.001);
    else this.camera.position.set(center.x + r * 0.55, r * 0.95, center.z + r * 1.05);
    this.controls.update();

    // shadows cover the house
    this.sun.position.set(center.x + r * 0.6, r * 1.5, center.z + r * 0.3);
    this.sun.target.position.copy(center);
    const cam = this.sun.shadow.camera;
    cam.left = cam.bottom = -r;
    cam.right = cam.top = r;
    cam.near = 0.1;
    cam.far = r * 4;
    cam.updateProjectionMatrix();
    this.needsRender = true;
  }

  // ---------- structure (walls, openings, floors) ----------

  private syncStructure() {
    const plan = this.store.plan;
    const sel = this.store.selection;
    const selKey = sel && sel.kind !== 'furniture' ? `${sel.kind}:${sel.id}` : '';
    const key = JSON.stringify([plan.walls, plan.openings, plan.areas, this.cutaway, selKey]);
    if (key === this.structureKey) return;
    this.structureKey = key;

    disposeGroup(this.structure);
    const exts = wallEndExtensions(plan);
    this.colliders = [];
    const wallMat = new THREE.MeshStandardMaterial({ color: COLORS.wall, roughness: 0.9 });
    const wallSelMat = new THREE.MeshStandardMaterial({ color: COLORS.wallSelected, roughness: 0.9 });
    const glassMat = new THREE.MeshStandardMaterial({ color: COLORS.glass, transparent: true, opacity: 0.35, roughness: 0.1, metalness: 0.1 });
    const glassSelMat = new THREE.MeshStandardMaterial({ color: COLORS.accent, transparent: true, opacity: 0.5 });
    const doorMat = new THREE.MeshStandardMaterial({ color: COLORS.door, roughness: 0.7 });
    const doorSelMat = new THREE.MeshStandardMaterial({ color: COLORS.accent, roughness: 0.7 });
    const frameMat = new THREE.MeshStandardMaterial({ color: COLORS.frame, roughness: 0.5, metalness: 0.2 });

    for (const w of plan.walls) {
      const openings = plan.openings.filter((o) => o.wallId === w.id).sort((a, b) => a.offset - b.offset);
      const selected = sel?.kind === 'wall' && sel.id === w.id;
      this.buildWall(w, openings, exts.get(w.id)!, selected ? wallSelMat : wallMat);
      for (const o of openings) {
        const oSel = sel?.kind === 'opening' && sel.id === o.id;
        if (!isDoor(o.kind)) this.buildWindow(w, o, oSel ? glassSelMat : glassMat);
        else if (o.kind === 'terraceDoor') this.buildDoor(w, o, oSel ? doorSelMat : frameMat, oSel ? glassSelMat : glassMat);
        else this.buildDoor(w, o, oSel ? doorSelMat : doorMat);
      }
    }

    const floorMat = new THREE.MeshStandardMaterial({ color: COLORS.floor, roughness: 0.85 });
    for (const room of findRooms(plan)) {
      // Shape is built in (x, -y) so that rotating -90° about X lands it on world (x, z=y).
      const shape = new THREE.Shape(room.floor.map((p) => new THREE.Vector2(p.x, -p.y)));
      const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), floorMat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = 0.002;
      mesh.receiveShadow = true;
      this.structure.add(mesh);
    }

    // terraces and balconies: a tiled slab just above the ground
    for (const a of plan.areas) {
      const selected = sel?.kind === 'area' && sel.id === a.id;
      const tex = tileTexture();
      tex.repeat.set(a.width / 0.4, a.length / 0.4);
      const mat = new THREE.MeshStandardMaterial({ color: selected ? COLORS.accent : COLORS.tile, map: tex, roughness: 0.9 });
      const slab = 0.04;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(a.width, slab, a.length), mat);
      mesh.position.set(a.x + a.width / 2, slab / 2 - 0.01, a.y + a.length / 2);
      mesh.receiveShadow = true;
      mesh.userData.pick = { kind: 'area', id: a.id } satisfies Pick;
      this.structure.add(mesh);
    }
  }

  /** Adds a box spanning [s0, s1] along the wall and [y0, y1] in height. */
  private wallPiece(w: Wall, s0: number, s1: number, y0: number, y1: number, mat: THREE.Material, pick: Pick) {
    if (s1 - s0 < 1e-4 || y1 - y0 < 1e-4) return;
    const d = wallDir(w);
    const mid = (s0 + s1) / 2;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(s1 - s0, y1 - y0, w.thickness), mat);
    mesh.position.set(w.a.x + d.x * mid, (y0 + y1) / 2, w.a.y + d.y * mid);
    mesh.rotation.y = -Math.atan2(d.y, d.x);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.pick = pick;
    this.structure.add(mesh);
  }

  private wallTop(w: Wall) {
    return this.cutaway ? Math.min(w.height, CUTAWAY_HEIGHT) : w.height;
  }

  private buildWall(w: Wall, openings: Opening[], ext: { a: number; b: number }, mat: THREE.Material) {
    const L = wallLength(w);
    this.addWallColliders(w, openings, ext);
    const top = this.wallTop(w);
    const pick: Pick = { kind: 'wall', id: w.id };
    let s = -ext.a;
    for (const o of openings) {
      const o0 = Math.max(0, o.offset - o.width / 2);
      const o1 = Math.min(L, o.offset + o.width / 2);
      this.wallPiece(w, s, o0, 0, top, mat, pick);
      this.wallPiece(w, o0, o1, 0, Math.min(o.sill, top), mat, pick);
      this.wallPiece(w, o0, o1, o.sill + o.height, top, mat, pick);
      s = Math.max(s, o1);
    }
    this.wallPiece(w, s, L + ext.b, 0, top, mat, pick);
  }

  private buildWindow(w: Wall, o: Opening, mat: THREE.Material) {
    const top = this.wallTop(w);
    const y1 = Math.min(o.sill + o.height, top);
    if (y1 <= o.sill) return;
    const d = wallDir(w);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(o.width, y1 - o.sill, 0.03), mat);
    mesh.position.set(w.a.x + d.x * o.offset, (o.sill + y1) / 2, w.a.y + d.y * o.offset);
    mesh.rotation.y = -Math.atan2(d.y, d.x);
    mesh.userData.pick = { kind: 'opening', id: o.id } satisfies Pick;
    this.structure.add(mesh);
  }

  /**
   * Door leaf standing open at 90°, matching the swing drawn on the plan.
   * With `glass`, the leaf is a glazed terrace door: a frame of `mat` around a pane of `glass`.
   */
  private buildDoor(w: Wall, o: Opening, mat: THREE.Material, glass?: THREE.Material) {
    const d = wallDir(w);
    const n = { x: -d.y, y: d.x };
    const side = o.flipSwing ? -1 : 1;
    const hingeAlong = o.flipHinge ? o.offset + o.width / 2 : o.offset - o.width / 2;
    const leafT = 0.04;
    // hinge sits on the wall face; leaf extends along the normal, inset by half its thickness
    const hx = w.a.x + d.x * hingeAlong + n.x * side * (w.thickness / 2);
    const hy = w.a.y + d.y * hingeAlong + n.y * side * (w.thickness / 2);
    const inset = (o.flipHinge ? -1 : 1) * leafT / 2;
    const cx = hx + n.x * side * (o.width / 2) + d.x * inset;
    const cy = hy + n.y * side * (o.width / 2) + d.y * inset;
    const h = Math.min(o.height, 2.4);
    const pick: Pick = { kind: 'opening', id: o.id };
    const leaf = new THREE.Group();
    leaf.position.set(cx, o.sill + h / 2, cy);
    leaf.rotation.y = -Math.atan2(d.y, d.x);
    const part = (sx: number, sy: number, sz: number, y: number, z: number, m: THREE.Material) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), m);
      mesh.position.set(0, y, z);
      mesh.castShadow = m !== glass;
      mesh.userData.pick = pick;
      leaf.add(mesh);
    };
    if (glass) {
      const f = Math.min(0.07, o.width / 4, h / 4);
      part(leafT, f, o.width, h / 2 - f / 2, 0, mat);
      part(leafT, f, o.width, -h / 2 + f / 2, 0, mat);
      part(leafT, h - 2 * f, f, 0, o.width / 2 - f / 2, mat);
      part(leafT, h - 2 * f, f, 0, -o.width / 2 + f / 2, mat);
      part(leafT / 2, h - 2 * f, o.width - 2 * f, 0, 0, glass);
    } else {
      part(leafT, h, o.width, 0, 0, mat);
    }
    if (!this.cutaway) this.structure.add(leaf);
  }

  /** Solid stretches of the wall between the openings you can walk through. */
  private addWallColliders(w: Wall, openings: Opening[], ext: { a: number; b: number }) {
    const L = wallLength(w);
    const d = wallDir(w);
    const add = (s0: number, s1: number) => {
      if (s1 - s0 < 1e-4) return;
      const mid = (s0 + s1) / 2;
      this.colliders.push({ c: { x: w.a.x + d.x * mid, y: w.a.y + d.y * mid }, u: d, hu: (s1 - s0) / 2, hv: w.thickness / 2 });
    };
    let s = -ext.a;
    for (const o of openings.filter(isPassable)) {
      add(s, Math.max(0, o.offset - o.width / 2));
      s = Math.max(s, Math.min(L, o.offset + o.width / 2));
    }
    add(s, L + ext.b);
  }

  private allColliders(): Collider[] {
    const boxes = this.store.plan.furniture.filter(blocksWalking).map((f) => {
      const r = (f.rotation * Math.PI) / 180;
      return { c: { x: f.x, y: f.y }, u: { x: Math.cos(r), y: Math.sin(r) }, hu: f.width / 2, hv: f.length / 2 };
    });
    return [...this.colliders, ...boxes];
  }

  // ---------- walking ----------

  get walking() {
    return !!this.walk;
  }

  /** Starts first-person mode at a plan point (or a roomy spot in the largest room), facing along yaw. */
  enterWalk(at?: Vec2, yaw?: number) {
    if (this.walk || !this.active) return;
    const el = this.renderer.domElement;
    const saved = { position: this.camera.position.clone(), target: this.controls.target.clone(), cutaway: this.cutaway };
    if (this.cutaway) this.toggleCutaway();
    const colliders = this.allColliders();
    const start = at ? resolveCollisions(at, colliders) : this.spawnPoint(colliders);
    const dir = this.camera.getWorldDirection(new THREE.Vector3());
    this.walk = { yaw: yaw ?? Math.atan2(-dir.x, -dir.z), pitch: 0, keys: new Set(), last: performance.now(), saved };
    this.controls.enabled = false;
    this.camera.fov = WALK.fov;
    this.camera.updateProjectionMatrix();
    this.camera.position.set(start.x, WALK.eyeHeight, start.y);
    this.applyLook();
    this.store.select(null);
    this.placePreview.visible = false;
    this.walkHint.hidden = false;
    this.container.querySelector('[data-act="walk"]')!.classList.add('active');
    el.style.cursor = 'none';
    el.requestPointerLock?.()?.catch?.(() => {});
  }

  exitWalk() {
    const walk = this.walk;
    if (!walk) return;
    this.walk = null;
    if (document.pointerLockElement === this.renderer.domElement) document.exitPointerLock();
    this.camera.fov = 50;
    this.camera.updateProjectionMatrix();
    this.camera.position.copy(walk.saved.position);
    this.controls.target.copy(walk.saved.target);
    this.controls.enabled = true;
    this.controls.update();
    if (walk.saved.cutaway !== this.cutaway) this.toggleCutaway();
    this.walkHint.hidden = true;
    this.container.querySelector('[data-act="walk"]')!.classList.remove('active');
    this.renderer.domElement.style.cursor = 'default';
    this.needsRender = true;
  }

  /** The spot in the largest room that is farthest from walls and furniture (capped), preferring its middle. */
  private spawnPoint(colliders: Collider[]): Vec2 {
    const rooms = findRooms(this.store.plan).sort((a, b) => b.area - a.area);
    if (!rooms.length) {
      const c = this.bounds().getCenter(new THREE.Vector3());
      return resolveCollisions({ x: c.x, y: c.z + this.bounds().getSize(new THREE.Vector3()).z / 2 + 2 }, colliders);
    }
    const room = rooms[0];
    const xs = room.floor.map((p) => p.x);
    const ys = room.floor.map((p) => p.y);
    let best = room.center;
    let bestScore = -Infinity;
    for (let x = Math.min(...xs); x <= Math.max(...xs); x += 0.2) {
      for (let y = Math.min(...ys); y <= Math.max(...ys); y += 0.2) {
        const p = { x, y };
        if (!pointInPolygon(p, room.floor)) continue;
        const score = Math.min(clearance(p, colliders), 1) - 0.05 * dist(p, room.center);
        if (score > bestScore) {
          bestScore = score;
          best = p;
        }
      }
    }
    return best;
  }

  private applyLook() {
    const w = this.walk!;
    this.camera.rotation.set(w.pitch, w.yaw, 0, 'YXZ');
    this.needsRender = true;
  }

  private onWalkLook(e: MouseEvent) {
    const w = this.walk;
    if (!w) return;
    // without pointer lock (e.g. the browser refused it), look around by dragging
    if (document.pointerLockElement !== this.renderer.domElement && !e.buttons) return;
    w.yaw -= e.movementX * WALK.lookSensitivity;
    w.pitch = THREE.MathUtils.clamp(w.pitch - e.movementY * WALK.lookSensitivity, -1.45, 1.45);
    this.applyLook();
  }

  private onWalkKey(e: KeyboardEvent, down: boolean) {
    const w = this.walk;
    if (!w) {
      if (down && !e.metaKey && !e.ctrlKey && e.key.toLowerCase() === 'p' && this.active && !isTyping(e)) this.enterWalk();
      return;
    }
    if (down && e.key === 'Escape') return this.exitWalk();
    if (e.metaKey || e.ctrlKey) return;
    if (down) w.keys.add(e.code);
    else w.keys.delete(e.code);
    e.preventDefault();
  }

  private stepWalk() {
    const w = this.walk!;
    const now = performance.now();
    const dt = Math.min((now - w.last) / 1000, 0.05);
    w.last = now;
    const k = w.keys;
    const fwd = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const side = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    if (!fwd && !side) return;
    const speed = (k.has('ShiftLeft') || k.has('ShiftRight') ? WALK.runSpeed : WALK.speed) * dt;
    const n = Math.hypot(fwd, side);
    const sin = Math.sin(w.yaw);
    const cos = Math.cos(w.yaw);
    // camera looks down -z at yaw 0; plan (x, y) is world (x, z)
    const dx = ((-sin * fwd + cos * side) / n) * speed;
    const dy = ((-cos * fwd - sin * side) / n) * speed;
    const p = resolveCollisions({ x: this.camera.position.x + dx, y: this.camera.position.z + dy }, this.allColliders());
    this.camera.position.set(p.x, WALK.eyeHeight, p.y);
    this.needsRender = true;
  }

  // ---------- furniture ----------

  private syncFurniture() {
    const plan = this.store.plan;
    const sel = this.store.selection;
    const seen = new Set<string>();
    for (const f of plan.furniture) {
      seen.add(f.id);
      let mesh = this.furnitureMeshes.get(f.id);
      if (!mesh) {
        mesh = new THREE.Mesh(this.unitBox, new THREE.MeshStandardMaterial({ roughness: 0.75 }));
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.add(new THREE.LineSegments(this.unitEdges, new THREE.LineBasicMaterial({ color: COLORS.edge, transparent: true, opacity: 0.45 })));
        mesh.userData.pick = { kind: 'furniture', id: f.id } satisfies Pick;
        this.furnitureMeshes.set(f.id, mesh);
        this.furnitureGroup.add(mesh);
      }
      this.applyFurniture(mesh, f, sel);
    }
    for (const [id, mesh] of this.furnitureMeshes) {
      if (seen.has(id)) continue;
      (mesh.material as THREE.Material).dispose();
      ((mesh.children[0] as THREE.LineSegments).material as THREE.Material).dispose();
      this.furnitureGroup.remove(mesh);
      this.furnitureMeshes.delete(id);
    }
  }

  private applyFurniture(mesh: THREE.Mesh, f: Furniture, sel: Selection) {
    mesh.position.set(f.x, f.elevation, f.y);
    mesh.rotation.y = planAngleToY(f.rotation);
    mesh.scale.set(Math.max(f.width, 0.01), Math.max(f.height, 0.01), Math.max(f.length, 0.01));
    const mat = mesh.material as THREE.MeshStandardMaterial;
    const selected = sel?.kind === 'furniture' && sel.id === f.id;
    mat.color.set(f.color);
    mat.emissive.set(selected ? COLORS.accent : 0x000000);
    mat.emissiveIntensity = selected ? 0.35 : 0;
    const edges = (mesh.children[0] as THREE.LineSegments).material as THREE.LineBasicMaterial;
    edges.color.set(selected ? COLORS.accent : COLORS.edge);
    edges.opacity = selected ? 1 : 0.45;
  }

  // ---------- picking & dragging ----------

  private ndc(e: PointerEvent) {
    const r = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }

  private pick(e: PointerEvent): Pick | null {
    this.raycaster.setFromCamera(this.ndc(e), this.camera);
    const hits = this.raycaster.intersectObjects([...this.furnitureGroup.children, ...this.structure.children], false);
    for (const h of hits) {
      const p = h.object.userData.pick as Pick | undefined;
      if (p) return p;
    }
    return null;
  }

  private floorPoint(e: PointerEvent): THREE.Vector3 | null {
    this.raycaster.setFromCamera(this.ndc(e), this.camera);
    return this.raycaster.ray.intersectPlane(this.floorPlane, new THREE.Vector3());
  }

  private onDoubleClick(e: MouseEvent) {
    if (this.walk || this.store.ui.tool === 'furniture') return;
    const p = this.floorPoint(e as PointerEvent);
    if (!p) return;
    const dir = new THREE.Vector3(p.x - this.camera.position.x, 0, p.z - this.camera.position.z);
    this.enterWalk({ x: p.x, y: p.z }, Math.atan2(-dir.x, -dir.z));
  }

  private onPointerDown(e: PointerEvent) {
    if (this.walk) {
      // clicking again after the browser dropped pointer lock picks it back up
      if (document.pointerLockElement !== this.renderer.domElement) this.renderer.domElement.requestPointerLock?.()?.catch?.(() => {});
      return;
    }
    if (e.button !== 0) return;
    this.downAt = { x: e.clientX, y: e.clientY };
    const store = this.store;

    if (store.ui.tool === 'furniture') {
      this.controls.enabled = false;
      return;
    }
    const hit = this.pick(e);
    if (hit?.kind === 'furniture') {
      const f = store.plan.furniture.find((x) => x.id === hit.id);
      const p = this.floorPoint(e);
      if (!f || !p) return;
      this.controls.enabled = false;
      this.renderer.domElement.setPointerCapture(e.pointerId);
      store.checkpoint();
      this.drag = { id: f.id, offset: new THREE.Vector2(f.x - p.x, f.y - p.z), moved: false };
      store.select({ kind: 'furniture', id: f.id });
    }
  }

  private onPointerMove(e: PointerEvent) {
    if (this.walk) return;
    const store = this.store;
    const el = this.renderer.domElement;
    if (this.drag) {
      const p = this.floorPoint(e);
      const f = store.plan.furniture.find((x) => x.id === this.drag!.id);
      if (p && f) {
        const q = snapToGrid({ x: p.x + this.drag.offset.x, y: p.z + this.drag.offset.y }, store.ui.snap);
        if (q.x !== f.x || q.y !== f.y) {
          f.x = q.x;
          f.y = q.y;
          this.drag.moved = true;
          store.emit();
        }
      }
      return;
    }
    if (store.ui.tool === 'furniture') {
      const p = this.floorPoint(e);
      this.placePreview.visible = !!p;
      if (p) {
        const q = snapToGrid({ x: p.x, y: p.z }, store.ui.snap);
        this.placePreview.position.set(q.x, 0, q.y);
      }
      el.style.cursor = 'crosshair';
      this.needsRender = true;
      return;
    }
    if (e.buttons === 0) el.style.cursor = this.pick(e)?.kind === 'furniture' ? 'move' : 'default';
  }

  private onPointerUp(e: PointerEvent) {
    if (this.walk) return;
    const store = this.store;
    const wasClick = this.downAt && Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y) < 5;
    this.downAt = null;
    this.controls.enabled = true;

    if (this.drag) {
      this.renderer.domElement.releasePointerCapture(e.pointerId);
      if (!this.drag.moved) store.dropCheckpoint();
      this.drag = null;
      return;
    }
    if (!wasClick || e.button !== 0) return;

    if (store.ui.tool === 'furniture') {
      const p = this.floorPoint(e);
      if (!p) return;
      const q = snapToGrid({ x: p.x, y: p.z }, store.ui.snap);
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
      this.placePreview.visible = false;
      store.emit();
      return;
    }
    // plain click: select whatever is under the cursor (walls/openings too, for editing in the panel)
    store.select(this.pick(e));
  }
}

function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement;
  return t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA';
}

/** Closest point of the collider to p, and whether p is inside it. */
function closestOnCollider(p: Vec2, c: Collider) {
  const dx = p.x - c.c.x;
  const dy = p.y - c.c.y;
  const lu = dx * c.u.x + dy * c.u.y;
  const lv = -dx * c.u.y + dy * c.u.x;
  const cu = THREE.MathUtils.clamp(lu, -c.hu, c.hu);
  const cv = THREE.MathUtils.clamp(lv, -c.hv, c.hv);
  const inside = cu === lu && cv === lv;
  return { lu, lv, cu, cv, inside };
}

function clearance(p: Vec2, colliders: Collider[]) {
  let m = Infinity;
  for (const c of colliders) {
    const q = closestOnCollider(p, c);
    m = Math.min(m, q.inside ? 0 : Math.hypot(q.lu - q.cu, q.lv - q.cv));
  }
  return m;
}

/** Pushes a walker-sized circle at p out of every collider, sliding along walls. */
function resolveCollisions(p: Vec2, colliders: Collider[]): Vec2 {
  const r = WALK.radius;
  let { x, y } = p;
  for (let iter = 0; iter < 4; iter++) {
    let moved = false;
    for (const c of colliders) {
      const q = closestOnCollider({ x, y }, c);
      let pu: number;
      let pv: number;
      if (q.inside) {
        // push out through the nearest side
        const du = c.hu - Math.abs(q.lu);
        const dv = c.hv - Math.abs(q.lv);
        if (du < dv) [pu, pv] = [Math.sign(q.lu || 1) * (du + r), 0];
        else [pu, pv] = [0, Math.sign(q.lv || 1) * (dv + r)];
      } else {
        const ou = q.lu - q.cu;
        const ov = q.lv - q.cv;
        const d = Math.hypot(ou, ov);
        if (d >= r) continue;
        [pu, pv] = [(ou / d) * (r - d), (ov / d) * (r - d)];
      }
      x += pu * c.u.x - pv * c.u.y;
      y += pu * c.u.y + pv * c.u.x;
      moved = true;
    }
    if (!moved) break;
  }
  return { x, y };
}

function disposeGroup(group: THREE.Group) {
  const materials = new Set<THREE.Material>();
  for (const child of [...group.children]) {
    child.traverse((o) => {
      const mesh = o as THREE.Mesh;
      mesh.geometry?.dispose();
      const m = mesh.material;
      if (Array.isArray(m)) m.forEach((x) => materials.add(x));
      else if (m) materials.add(m);
    });
    group.remove(child);
  }
  materials.forEach((m) => {
    (m as THREE.MeshStandardMaterial).map?.dispose();
    m.dispose();
  });
}

/** One floor tile with grout lines, repeated across terraces and balconies. */
function tileTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 64, 64);
  ctx.strokeStyle = '#a89c8a';
  ctx.lineWidth = 3;
  ctx.strokeRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
