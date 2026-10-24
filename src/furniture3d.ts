import * as THREE from 'three';
import type { Furniture } from './model';

// Builds a 3D model for a piece of furniture at its real size.
// Local frame: origin at the center of the footprint on the floor, x across the width,
// z across the length with the front at +z, y up. The caller places and rotates the group.

const C = {
  wood: 0x8a6a4f,
  darkWood: 0x4a3a2e,
  metal: 0x9a9ea3,
  dark: 0x26282b,
  stone: 0x5b5d60,
  linen: 0xf3f1ec,
  pillow: 0xe4e1da,
  leaf: 0x4f7a3a,
  leafLight: 0x6b9450,
  soil: 0x3b2d22,
  glass: 0xbcd8ec,
};

const BOOK_COLORS = [0x8c3b2f, 0x2f4f6f, 0xc9a24a, 0x4e6b45, 0xe0d6c2, 0x5a4a6e, 0x2b2b2b, 0xa65e2e];

type Mat = THREE.MeshStandardMaterial;

class Builder {
  group = new THREE.Group();
  private cache = new Map<string, Mat>();

  mat(color: THREE.ColorRepresentation, opts: THREE.MeshStandardMaterialParameters = {}): Mat {
    const key = `${new THREE.Color(color).getHexString()}:${JSON.stringify(opts)}`;
    let m = this.cache.get(key);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color, roughness: 0.75, ...opts });
      m.userData.emissive = m.emissive.getHex();
      m.userData.emissiveIntensity = m.emissiveIntensity;
      this.cache.set(key, m);
    }
    return m;
  }

  add(geo: THREE.BufferGeometry, mat: Mat, x: number, y: number, z: number, shadow = true) {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = shadow && !mat.transparent;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    return mesh;
  }

  /** A box spanning [x0, x1] × [y0, y1] × [z0, z1]. */
  box(mat: Mat, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, shadow = true) {
    const w = x1 - x0;
    const h = y1 - y0;
    const d = z1 - z0;
    if (w <= 1e-4 || h <= 1e-4 || d <= 1e-4) return null;
    return this.add(new THREE.BoxGeometry(w, h, d), mat, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, shadow);
  }

  /** An upright cylinder (or cone) from y0 to y1, optionally squashed into an ellipse. */
  cyl(mat: Mat, rTop: number, rBottom: number, y0: number, y1: number, x = 0, z = 0, sx = 1, sz = 1, open = false) {
    if (y1 - y0 <= 1e-4) return null;
    const mesh = this.add(new THREE.CylinderGeometry(rTop, rBottom, y1 - y0, 28, 1, open), mat, x, (y0 + y1) / 2, z);
    mesh.scale.set(sx, 1, sz);
    return mesh;
  }

  /** Door or drawer fronts across [x0, x1] × [y0, y1] on the face at z, with handles. */
  fronts(mat: Mat, handle: Mat, x0: number, x1: number, y0: number, y1: number, z: number, cols: number, rows: number, kind: 'door' | 'drawer') {
    const gap = 0.006;
    const cw = (x1 - x0) / cols;
    const rh = (y1 - y0) / rows;
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        const a = x0 + i * cw + gap;
        const b = x0 + (i + 1) * cw - gap;
        const lo = y0 + j * rh + gap;
        const hi = y0 + (j + 1) * rh - gap;
        this.box(mat, a, b, lo, hi, z, z + 0.018);
        if (kind === 'drawer') {
          const hw = Math.min(0.08, (b - a) * 0.25);
          this.box(handle, (a + b) / 2 - hw, (a + b) / 2 + hw, hi - Math.min(0.05, rh * 0.3) - 0.012, hi - Math.min(0.05, rh * 0.3), z + 0.018, z + 0.032);
        } else {
          // handles meet in the middle of each pair of doors
          const hx = i % 2 === 0 && i < cols - 1 ? b - 0.04 : i % 2 === 1 ? a + 0.04 : b - 0.04;
          const hh = Math.min(0.12, (hi - lo) * 0.2);
          const hy = Math.min(hi - hh - 0.05, lo + 1.0);
          this.box(handle, hx - 0.006, hx + 0.006, hy, hy + hh, z + 0.018, z + 0.032);
        }
      }
    }
  }
}

/** Small deterministic random numbers, so bookshelves look the same on every rebuild. */
function rng(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

const shade = (color: string, k: number) => new THREE.Color(color).multiplyScalar(k);
const lighten = (color: string, k: number) => new THREE.Color(color).lerp(new THREE.Color(0xffffff), k);

export function buildFurniture(f: Furniture): THREE.Group {
  const b = new Builder();
  const W = Math.max(f.width, 0.02);
  const L = Math.max(f.length, 0.02);
  const H = Math.max(f.height, 0.005);
  const hw = W / 2;
  const hl = L / 2;
  const main = b.mat(f.color);
  const metal = b.mat(C.metal, { metalness: 0.6, roughness: 0.35 });

  const legs = (mat: Mat, size: number, inset: number, y0: number, y1: number) => {
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const x = sx * (hw - inset - size / 2);
        const z = sz * (hl - inset - size / 2);
        b.box(mat, x - size / 2, x + size / 2, y0, y1, z - size / 2, z + size / 2);
      }
  };

  switch (f.kind) {
    case 'sofa':
    case 'armchair': {
      const leg = Math.min(0.08, H * 0.1);
      const arm = Math.min(0.18, W * 0.14);
      const back = Math.min(0.22, L * 0.25);
      const seatTop = Math.min(0.45, H * 0.55);
      const cushion = Math.min(0.14, seatTop * 0.35);
      const baseTop = seatTop - cushion;
      const armTop = seatTop + (H - seatTop) * 0.45;
      const cushionMat = b.mat(lighten(f.color, 0.08));
      legs(b.mat(C.darkWood), 0.05, 0.04, 0, leg);
      b.box(main, -hw, hw, leg, baseTop, -hl, hl);
      b.box(main, -hw, hw, baseTop, H, -hl, -hl + back);
      b.box(main, -hw, -hw + arm, baseTop, armTop, -hl + back, hl);
      b.box(main, hw - arm, hw, baseTop, armTop, -hl + back, hl);
      const inner = W - 2 * arm;
      const n = Math.max(1, Math.round(inner / 0.75));
      const cw = inner / n;
      const backCushion = L - back > 0.45 ? Math.min(0.16, (L - back) * 0.25) : 0;
      for (let i = 0; i < n; i++) {
        const x0 = -hw + arm + i * cw + 0.005;
        const x1 = x0 + cw - 0.01;
        b.box(cushionMat, x0, x1, baseTop, seatTop, -hl + back + backCushion, hl - 0.02);
        if (backCushion) b.box(cushionMat, x0, x1, baseTop, H - 0.04, -hl + back, -hl + back + backCushion);
      }
      break;
    }

    case 'bed': {
      const wood = b.mat(C.wood);
      const mattressTop = Math.min(0.55, H * 0.85);
      const frameTop = mattressTop * 0.55;
      const head = Math.min(0.06, L * 0.05);
      b.box(wood, -hw, hw, 0, frameTop, -hl, hl);
      b.box(wood, -hw, hw, 0, H, -hl, -hl + head);
      b.box(b.mat(C.linen), -hw + 0.03, hw - 0.03, frameTop, mattressTop, -hl + head, hl - 0.03);
      // duvet over the foot end, in the bed's color
      b.box(main, -hw + 0.01, hw - 0.01, frameTop + 0.05, mattressTop + 0.03, -hl + head + L * 0.3, hl - 0.01);
      const pillows = W >= 1.2 ? 2 : 1;
      const pw = (W - 0.16) / pillows;
      for (let i = 0; i < pillows; i++) {
        const x0 = -hw + 0.08 + i * pw + 0.03;
        b.box(b.mat(C.pillow), x0, x0 + pw - 0.06, mattressTop, mattressTop + 0.11, -hl + head + 0.06, -hl + head + Math.min(0.45, L * 0.22));
      }
      break;
    }

    case 'nightstand': {
      const leg = Math.min(0.06, H * 0.1);
      legs(b.mat(C.darkWood), 0.03, 0.02, 0, leg);
      b.box(main, -hw, hw, leg, H, -hl, hl - 0.018);
      b.fronts(b.mat(lighten(f.color, 0.12)), metal, -hw + 0.02, hw - 0.02, leg + 0.02, H - 0.03, hl - 0.018, 1, 2, 'drawer');
      break;
    }

    case 'diningTable':
    case 'coffeeTable':
    case 'desk': {
      const top = Math.min(0.04, H * 0.15);
      const legMat = b.mat(shade(f.color, 0.75));
      b.box(main, -hw, hw, H - top, H, -hl, hl);
      legs(legMat, Math.min(0.05, W * 0.08, L * 0.08), Math.min(0.05, W * 0.05), 0, H - top);
      if (f.kind === 'coffeeTable' && H > 0.25) b.box(main, -hw + 0.06, hw - 0.06, H * 0.25, H * 0.25 + 0.02, -hl + 0.06, hl - 0.06);
      if (f.kind === 'desk' && W >= 1) {
        const x0 = hw - Math.min(0.42, W * 0.3);
        b.box(legMat, x0, hw - 0.02, H * 0.3, H - top, -hl + 0.04, hl - 0.05);
        b.fronts(main, metal, x0 + 0.01, hw - 0.03, H * 0.3 + 0.01, H - top - 0.01, hl - 0.05, 1, 3, 'drawer');
      }
      break;
    }

    case 'chair': {
      const seat = Math.min(0.46, H * 0.5);
      const t = 0.035;
      const legMat = b.mat(shade(f.color, 0.7));
      b.box(main, -hw, hw, seat - 0.04, seat, -hl, hl);
      for (const sx of [-1, 1]) {
        b.box(legMat, sx * hw - (sx > 0 ? t : 0), sx * hw + (sx < 0 ? t : 0), 0, seat - 0.04, hl - t, hl);
        b.box(legMat, sx * hw - (sx > 0 ? t : 0), sx * hw + (sx < 0 ? t : 0), 0, H, -hl, -hl + t);
      }
      b.box(main, -hw + t, hw - t, seat + (H - seat) * 0.4, H, -hl, -hl + 0.025);
      break;
    }

    case 'wardrobe': {
      const plinth = Math.min(0.06, H * 0.05);
      b.box(b.mat(shade(f.color, 0.6)), -hw + 0.02, hw - 0.02, 0, plinth, -hl, hl - 0.04);
      b.box(main, -hw, hw, plinth, H, -hl, hl - 0.018);
      const doors = Math.min(6, Math.max(1, Math.round(W / 0.5)));
      b.fronts(b.mat(lighten(f.color, 0.06)), metal, -hw, hw, plinth, H, hl - 0.018, doors, 1, 'door');
      break;
    }

    case 'bookshelf': {
      const t = 0.02;
      const plinth = Math.min(0.06, H * 0.08);
      b.box(main, -hw, -hw + t, 0, H, -hl, hl);
      b.box(main, hw - t, hw, 0, H, -hl, hl);
      b.box(main, -hw + t, hw - t, H - t, H, -hl, hl);
      b.box(main, -hw + t, hw - t, 0, plinth, -hl, hl);
      b.box(b.mat(shade(f.color, 0.8)), -hw + t, hw - t, plinth, H - t, -hl, -hl + 0.01);
      const n = Math.max(1, Math.round((H - plinth - t) / 0.36));
      const gap = (H - plinth - t) / n;
      const rand = rng(f.id);
      const books = new Map<number, Mat>();
      for (let i = 0; i < n; i++) {
        const y = plinth + i * gap;
        if (i > 0) b.box(main, -hw + t, hw - t, y - t / 2, y + t / 2, -hl + 0.01, hl);
        let x = -hw + t + 0.01;
        const end = -hw + t + (W - 2 * t) * (0.55 + rand() * 0.4);
        while (x < end) {
          const bw = 0.02 + rand() * 0.03;
          const bh = Math.min(gap - t, 0.2 + rand() * 0.12) * (0.75 + rand() * 0.25);
          const c = BOOK_COLORS[Math.floor(rand() * BOOK_COLORS.length)];
          if (!books.has(c)) books.set(c, b.mat(c, { roughness: 0.85 }));
          b.box(books.get(c)!, x, Math.min(x + bw, hw - t), y + t / 2, y + t / 2 + bh, -hl + 0.02, -hl + 0.02 + Math.min(0.22, L * 0.8));
          x += bw + 0.002;
          if (rand() < 0.06) x += 0.06;
        }
      }
      break;
    }

    case 'tvUnit': {
      const cab = Math.min(0.5, H * 0.4);
      b.box(main, -hw, hw, 0, cab, -hl, hl - 0.018);
      b.fronts(b.mat(lighten(f.color, 0.1)), metal, -hw + 0.01, hw - 0.01, 0.04, cab - 0.02, hl - 0.018, Math.max(1, Math.round(W / 0.6)), 1, 'drawer');
      const room = H - cab - 0.08;
      if (room > 0.1) {
        let sw = Math.min(W * 0.85, 1.6);
        let sh = sw * (9 / 16);
        if (sh > room) [sh, sw] = [room, room * (16 / 9)];
        const dark = b.mat(C.dark, { roughness: 0.4 });
        b.box(dark, -0.15, 0.15, cab, cab + 0.015, -0.08, 0.08);
        b.box(dark, -0.03, 0.03, cab, cab + 0.08, -0.02, 0.02);
        b.box(dark, -sw / 2, sw / 2, cab + 0.08, cab + 0.08 + sh, -0.04, -0.015);
        b.box(b.mat(0x101418, { roughness: 0.15, metalness: 0.3 }), -sw / 2 + 0.01, sw / 2 - 0.01, cab + 0.09, cab + 0.07 + sh, -0.015, -0.012);
      }
      break;
    }

    case 'kitchenCounter': {
      const top = 0.04;
      const plinth = Math.min(0.1, H * 0.12);
      b.box(b.mat(C.dark), -hw, hw, 0, plinth, -hl, hl - 0.06);
      b.box(main, -hw, hw, plinth, H - top, -hl, hl - 0.04);
      b.fronts(b.mat(lighten(f.color, 0.05)), metal, -hw, hw, plinth, H - top, hl - 0.04, Math.max(1, Math.round(W / 0.6)), 1, 'door');
      b.box(b.mat(C.stone, { roughness: 0.35 }), -hw, hw, H - top, H, -hl, hl);
      if (W >= 1.2 && L >= 0.45) {
        // sink and tap near the left end
        const sx = -hw + 0.45;
        b.box(b.mat(0xc4c8cc, { metalness: 0.7, roughness: 0.3 }), sx - 0.25, sx + 0.25, H, H + 0.004, -0.18, 0.2);
        b.box(b.mat(0x6f7378, { metalness: 0.7, roughness: 0.3 }), sx - 0.21, sx + 0.21, H + 0.004, H + 0.006, -0.14, 0.16);
        b.cyl(metal, 0.015, 0.02, H, H + 0.3, sx, -hl + 0.06);
        b.box(metal, sx - 0.012, sx + 0.012, H + 0.27, H + 0.295, -hl + 0.06, -hl + 0.22);
      }
      if (W >= 2 && L >= 0.5) {
        // hob near the right end
        const hx = hw - 0.4;
        b.box(b.mat(0x15171a, { roughness: 0.15 }), hx - 0.29, hx + 0.29, H, H + 0.006, -0.25, 0.25);
        const ring = b.mat(0x3a3d42, { roughness: 0.4 });
        for (const [dx, dz, r] of [[-0.14, -0.12, 0.09], [0.14, -0.12, 0.07], [-0.14, 0.12, 0.07], [0.14, 0.12, 0.09]]) b.cyl(ring, r, r, H + 0.006, H + 0.008, hx + dx, dz);
      }
      break;
    }

    case 'fridge': {
      b.box(main, -hw, hw, 0, H, -hl, hl - 0.03);
      const door = b.mat(lighten(f.color, 0.3), { roughness: 0.4 });
      const split = H * 0.38;
      b.box(door, -hw + 0.005, hw - 0.005, 0.01, split - 0.005, hl - 0.03, hl);
      b.box(door, -hw + 0.005, hw - 0.005, split + 0.005, H - 0.005, hl - 0.03, hl);
      const hx = -hw + 0.05;
      b.box(metal, hx - 0.01, hx + 0.01, split - 0.25, split - 0.05, hl, hl + 0.02);
      b.box(metal, hx - 0.01, hx + 0.01, split + 0.05, split + 0.45, hl, hl + 0.02);
      break;
    }

    case 'toilet': {
      const ceramic = b.mat(f.color, { roughness: 0.2 });
      const tank = Math.min(0.18, L * 0.3);
      const bowlTop = Math.min(0.4, H * 0.5);
      b.box(ceramic, -Math.min(hw, 0.19), Math.min(hw, 0.19), bowlTop - 0.05, H, -hl, -hl + tank);
      const rx = hw * 0.9;
      const rz = (L - tank) / 2;
      const cz = -hl + tank + rz;
      b.cyl(ceramic, 1, 0.65, 0, bowlTop, 0, cz - 0.02, rx, rz * 0.95);
      b.cyl(b.mat(0xffffff, { roughness: 0.3 }), 1, 1, bowlTop, bowlTop + 0.025, 0, cz - 0.02, rx * 1.02, rz * 0.97);
      b.box(metal, -0.03, 0.03, H, H + 0.005, -hl + tank * 0.3, -hl + tank * 0.7);
      break;
    }

    case 'bathtub': {
      const ceramic = b.mat(f.color, { roughness: 0.2 });
      const rim = Math.min(0.08, W * 0.08, L * 0.15);
      b.box(ceramic, -hw, hw, 0, H, -hl, -hl + rim);
      b.box(ceramic, -hw, hw, 0, H, hl - rim, hl);
      b.box(ceramic, -hw, -hw + rim, 0, H, -hl + rim, hl - rim);
      b.box(ceramic, hw - rim, hw, 0, H, -hl + rim, hl - rim);
      b.box(b.mat(lighten(f.color, 0.5), { roughness: 0.15 }), -hw + rim, hw - rim, 0, Math.min(0.12, H * 0.3), -hl + rim, hl - rim);
      b.cyl(metal, 0.02, 0.02, H, H + 0.12, -hw + rim / 2, 0);
      b.box(metal, -hw + rim / 2, -hw + rim + 0.08, H + 0.1, H + 0.12, -0.012, 0.012);
      break;
    }

    case 'shower': {
      const tray = Math.min(0.06, H * 0.05);
      b.box(b.mat(f.color, { roughness: 0.25 }), -hw, hw, 0, tray, -hl, hl);
      b.cyl(b.mat(C.dark), 0.04, 0.04, tray, tray + 0.002);
      const glass = b.mat(C.glass, { transparent: true, opacity: 0.28, roughness: 0.05, metalness: 0.1, depthWrite: false });
      b.box(glass, -hw, hw, tray, H, hl - 0.01, hl);
      b.box(glass, hw - 0.01, hw, tray, H, -hl, hl - 0.01);
      b.box(metal, -hw, hw, H - 0.02, H, hl - 0.015, hl);
      b.box(metal, hw - 0.015, hw, H - 0.02, H, -hl, hl);
      const px = -hw + 0.08;
      const pz = -hl + 0.04;
      b.cyl(metal, 0.012, 0.012, Math.min(1, H * 0.5), H - 0.12, px, pz);
      b.box(metal, px - 0.01, px + 0.01, H - 0.14, H - 0.12, pz, pz + 0.18);
      b.cyl(metal, 0.09, 0.09, H - 0.17, H - 0.145, px, pz + 0.2);
      break;
    }

    case 'washbasin': {
      const ceramic = b.mat(0xf7f7f5, { roughness: 0.2 });
      const counter = H - Math.min(0.15, H * 0.2);
      const cabBottom = Math.min(0.3, counter * 0.35);
      b.box(main, -hw, hw, cabBottom, counter - 0.1, -hl, hl - 0.03);
      b.fronts(b.mat(lighten(f.color, 0.1)), metal, -hw + 0.01, hw - 0.01, cabBottom + 0.01, counter - 0.11, hl - 0.03, W >= 1 ? 2 : 1, 1, 'drawer');
      b.box(ceramic, -hw, hw, counter - 0.1, counter, -hl, hl);
      b.box(b.mat(0xdfe3e6, { roughness: 0.15 }), -hw * 0.7, hw * 0.7, counter, counter + 0.002, -hl * 0.5, hl * 0.7);
      const tap = Math.min(H - counter, 0.15);
      b.cyl(metal, 0.015, 0.02, counter, counter + tap, 0, -hl + 0.06);
      b.box(metal, -0.012, 0.012, counter + tap - 0.025, counter + tap, -hl + 0.06, -hl + 0.16);
      break;
    }

    case 'rug': {
      const border = Math.min(0.08, W * 0.1, L * 0.1);
      const border3 = b.mat(shade(f.color, 0.75), { roughness: 1 });
      b.box(border3, -hw, hw, 0, H * 0.9, -hl, hl, false);
      b.box(b.mat(f.color, { roughness: 1 }), -hw + border, hw - border, 0, H, -hl + border, hl - border, false);
      break;
    }

    case 'plant': {
      const r = Math.min(W, L) / 2;
      const pot = Math.min(0.45, H * 0.3);
      b.cyl(main, r * 0.6, r * 0.45, 0, pot);
      b.cyl(b.mat(C.soil, { roughness: 1 }), r * 0.56, r * 0.56, pot - 0.03, pot - 0.01);
      b.cyl(b.mat(C.darkWood), 0.015, 0.02, pot - 0.02, H * 0.6);
      const R = Math.min(r * 0.75, (H - pot) / 2.4);
      const leaves = [b.mat(C.leaf, { flatShading: true }), b.mat(C.leafLight, { flatShading: true })];
      const blobs: [number, number, number, number][] = [
        [0, H - R, 0, 1],
        [R * 0.6, H - R * 1.7, R * 0.2, 0.8],
        [-R * 0.55, H - R * 1.8, -R * 0.25, 0.85],
        [R * 0.1, H - R * 2.1, -R * 0.6, 0.75],
        [-R * 0.15, H - R * 1.9, R * 0.6, 0.7],
      ];
      blobs.forEach(([x, y, z, s], i) => b.add(new THREE.IcosahedronGeometry(R * s, 1), leaves[i % 2], x, Math.max(y, pot + R * s * 0.8), z));
      break;
    }

    case 'floorLamp': {
      const r = Math.min(W, L) / 2;
      const dark = b.mat(C.dark, { metalness: 0.4, roughness: 0.4 });
      const shadeH = Math.min(0.32, H * 0.25);
      b.cyl(dark, r * 0.7, r * 0.75, 0, 0.03);
      b.cyl(dark, 0.012, 0.012, 0.03, H - shadeH * 0.5);
      const lampShade = b.mat(f.color, { side: THREE.DoubleSide, emissive: 0xffd9a0, emissiveIntensity: 0.35, roughness: 0.9 });
      b.cyl(lampShade, r * 0.65, r, H - shadeH, H, 0, 0, 1, 1, true);
      break;
    }

    default: {
      // plain box, with edges so its shape reads
      const mesh = b.box(main, -hw, hw, 0, H, -hl, hl)!;
      mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), new THREE.LineBasicMaterial({ color: 0x3a3a3a, transparent: true, opacity: 0.45 })));
    }
  }
  return b.group;
}

/** Tints every material of a furniture model to show it's selected, or restores it. */
export function highlightFurniture(group: THREE.Object3D, color: THREE.ColorRepresentation | null) {
  group.traverse((o) => {
    const m = (o as THREE.Mesh).material;
    if (m instanceof THREE.MeshStandardMaterial) {
      m.emissive.set(color ?? m.userData.emissive);
      m.emissiveIntensity = color ? 0.35 : m.userData.emissiveIntensity;
    } else if (m instanceof THREE.LineBasicMaterial) {
      m.color.set(color ?? 0x3a3a3a);
      m.opacity = color ? 1 : 0.45;
    }
  });
}

export function disposeObject(obj: THREE.Object3D) {
  obj.traverse((o) => {
    const mesh = o as THREE.Mesh;
    mesh.geometry?.dispose();
    const m = mesh.material;
    if (Array.isArray(m)) m.forEach((x) => x.dispose());
    else m?.dispose();
  });
}
