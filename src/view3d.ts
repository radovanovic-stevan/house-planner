import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { rectCorners, snapToGrid, wallDir, wallLength } from './geometry';
import { DEFAULTS, newId, type Furniture, type Opening, type Selection, type Wall } from './model';
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
  accent: 0x2f6fed,
  edge: 0x3a3a3a,
};

/** Walls are cut down to this height in cutaway mode so the rooms are visible from above. */
const CUTAWAY_HEIGHT = 1.1;

type Pick = { kind: 'wall' | 'opening' | 'furniture'; id: string };

type Drag = { id: string; offset: THREE.Vector2; moved: boolean };

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

  constructor(
    private container: HTMLElement,
    private store: Store,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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
      <button data-act="cutaway" title="Cut walls down to see inside (C)">Cutaway walls</button>
      <button data-act="top" title="Look straight down">Top view</button>
      <button data-act="reset" title="Frame the whole house">Reset camera</button>`;
    bar.addEventListener('click', (e) => {
      const act = (e.target as HTMLElement).closest('button')?.dataset.act;
      if (act === 'cutaway') this.toggleCutaway();
      if (act === 'top') this.frame(true);
      if (act === 'reset') this.frame(false);
    });
    this.container.append(bar);
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
    this.controls.update();
    if (this.needsRender) {
      this.needsRender = false;
      this.renderer.render(this.scene, this.camera);
    }
  };

  private sync() {
    if (!this.active) return;
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
    const key = JSON.stringify([plan.walls, plan.openings, this.cutaway, selKey]);
    if (key === this.structureKey) return;
    this.structureKey = key;

    disposeGroup(this.structure);
    const exts = wallEndExtensions(plan);
    const wallMat = new THREE.MeshStandardMaterial({ color: COLORS.wall, roughness: 0.9 });
    const wallSelMat = new THREE.MeshStandardMaterial({ color: COLORS.wallSelected, roughness: 0.9 });
    const glassMat = new THREE.MeshStandardMaterial({ color: COLORS.glass, transparent: true, opacity: 0.35, roughness: 0.1, metalness: 0.1 });
    const glassSelMat = new THREE.MeshStandardMaterial({ color: COLORS.accent, transparent: true, opacity: 0.5 });
    const doorMat = new THREE.MeshStandardMaterial({ color: COLORS.door, roughness: 0.7 });
    const doorSelMat = new THREE.MeshStandardMaterial({ color: COLORS.accent, roughness: 0.7 });

    for (const w of plan.walls) {
      const openings = plan.openings.filter((o) => o.wallId === w.id).sort((a, b) => a.offset - b.offset);
      const selected = sel?.kind === 'wall' && sel.id === w.id;
      this.buildWall(w, openings, exts.get(w.id)!, selected ? wallSelMat : wallMat);
      for (const o of openings) {
        const oSel = sel?.kind === 'opening' && sel.id === o.id;
        if (o.kind === 'window') this.buildWindow(w, o, oSel ? glassSelMat : glassMat);
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

  /** Door leaf standing open at 90°, matching the swing drawn on the plan. */
  private buildDoor(w: Wall, o: Opening, mat: THREE.Material) {
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
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(leafT, h, o.width), mat);
    mesh.position.set(cx, o.sill + h / 2, cy);
    mesh.rotation.y = -Math.atan2(d.y, d.x);
    mesh.castShadow = true;
    mesh.userData.pick = { kind: 'opening', id: o.id } satisfies Pick;
    if (!this.cutaway) this.structure.add(mesh);
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

  private onPointerDown(e: PointerEvent) {
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

function disposeGroup(group: THREE.Group) {
  const materials = new Set<THREE.Material>();
  for (const child of [...group.children]) {
    const mesh = child as THREE.Mesh;
    mesh.geometry?.dispose();
    const m = mesh.material;
    if (Array.isArray(m)) m.forEach((x) => materials.add(x));
    else if (m) materials.add(m);
    group.remove(child);
  }
  materials.forEach((m) => m.dispose());
}
