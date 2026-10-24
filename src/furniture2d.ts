import type { Furniture } from './model';

/**
 * Draws a furniture piece's plan symbol (the lines inside its outline), in the piece's own frame:
 * the caller has already moved the canvas to its center, rotated it and scaled it to meters.
 * Local x runs across the width, local y across the length with the front at +y.
 */
export function drawFurnitureSymbol(ctx: CanvasRenderingContext2D, f: Furniture, px: number) {
  const W = f.width;
  const L = f.length;
  const hw = W / 2;
  const hl = L / 2;
  const m = Math.min(W, L);

  const rect = (x0: number, y0: number, x1: number, y1: number, r = 0) => {
    ctx.beginPath();
    if (r > 0) ctx.roundRect(x0, y0, x1 - x0, y1 - y0, Math.min(r, (x1 - x0) / 2, (y1 - y0) / 2));
    else ctx.rect(x0, y0, x1 - x0, y1 - y0);
    ctx.stroke();
  };
  const line = (...pts: number[]) => {
    ctx.beginPath();
    ctx.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
    ctx.stroke();
  };
  const ellipse = (x: number, y: number, rx: number, ry: number) => {
    ctx.beginPath();
    ctx.ellipse(x, y, Math.max(rx, 0), Math.max(ry, 0), 0, 0, Math.PI * 2);
    ctx.stroke();
  };

  switch (f.kind) {
    case 'sofa':
    case 'armchair': {
      const arm = Math.min(0.18, W * 0.14);
      const back = Math.min(0.22, L * 0.25);
      rect(-hw, -hl, hw, -hl + back);
      rect(-hw, -hl + back, -hw + arm, hl, 0.04);
      rect(hw - arm, -hl + back, hw, hl, 0.04);
      const inner = W - 2 * arm;
      const n = Math.max(1, Math.round(inner / 0.75));
      for (let i = 1; i < n; i++) line(-hw + arm + (inner * i) / n, -hl + back, -hw + arm + (inner * i) / n, hl);
      break;
    }
    case 'bed': {
      const head = Math.min(0.06, L * 0.05);
      line(-hw, -hl + head, hw, -hl + head);
      const pillows = W >= 1.2 ? 2 : 1;
      const pw = (W - 0.16) / pillows;
      for (let i = 0; i < pillows; i++) {
        const x0 = -hw + 0.08 + i * pw + 0.03;
        rect(x0, -hl + head + 0.06, x0 + pw - 0.06, -hl + head + Math.min(0.45, L * 0.22), 0.06);
      }
      // duvet, folded back at the corner
      const fold = -hl + head + L * 0.3;
      line(-hw, fold, hw, fold);
      line(hw - Math.min(0.4, W * 0.3), fold, hw, fold + Math.min(0.4, W * 0.3));
      break;
    }
    case 'nightstand':
      rect(-hw + 0.03, -hl + 0.03, hw - 0.03, hl - 0.03);
      ellipse(0, 0, m * 0.2, m * 0.2);
      break;
    case 'diningTable':
    case 'desk':
      rect(-hw + 0.04, -hl + 0.04, hw - 0.04, hl - 0.04);
      if (f.kind === 'desk' && W >= 1) line(hw - Math.min(0.42, W * 0.3), -hl, hw - Math.min(0.42, W * 0.3), hl);
      break;
    case 'coffeeTable':
      rect(-hw + 0.06, -hl + 0.06, hw - 0.06, hl - 0.06, 0.05);
      break;
    case 'chair':
      rect(-hw, -hl, hw, -hl + Math.min(0.06, L * 0.15));
      rect(-hw + 0.03, -hl + 0.08, hw - 0.03, hl - 0.03, 0.03);
      break;
    case 'wardrobe': {
      // hanging rail with hangers
      line(-hw + 0.05, 0, hw - 0.05, 0);
      for (let x = -hw + 0.12; x < hw - 0.08; x += 0.12) line(x - 0.03, -L * 0.3, x + 0.03, L * 0.3);
      const doors = Math.min(6, Math.max(1, Math.round(W / 0.5)));
      for (let i = 1; i < doors; i++) line(-hw + (W * i) / doors, hl - 0.03, -hw + (W * i) / doors, hl);
      line(-hw, hl - 0.03, hw, hl - 0.03);
      break;
    }
    case 'bookshelf':
      line(-hw + 0.02, -hl + 0.02, hw - 0.02, -hl + 0.02);
      line(-hw + 0.02, -hl, -hw + 0.02, hl);
      line(hw - 0.02, -hl, hw - 0.02, hl);
      for (let x = -hw + 0.06; x < hw - 0.05; x += 0.05) line(x, -hl + 0.04, x, -hl + 0.04 + Math.min(0.22, L * 0.8) - 0.02);
      break;
    case 'tvUnit': {
      const sw = Math.min(W * 0.85, 1.6);
      rect(-sw / 2, -0.04, sw / 2, -0.015);
      rect(-0.15, -0.08, 0.15, 0.08);
      break;
    }
    case 'kitchenCounter':
      line(-hw, hl - 0.04, hw, hl - 0.04);
      if (W >= 1.2 && L >= 0.45) {
        const sx = -hw + 0.45;
        rect(sx - 0.21, -0.14, sx + 0.21, 0.16, 0.04);
        ellipse(sx, 0.01, 0.025, 0.025);
        line(sx, -hl + 0.06, sx, -hl + 0.22);
      }
      if (W >= 2 && L >= 0.5) {
        const hx = hw - 0.4;
        rect(hx - 0.29, -0.25, hx + 0.29, 0.25);
        for (const [dx, dy, r] of [[-0.14, -0.12, 0.09], [0.14, -0.12, 0.07], [-0.14, 0.12, 0.07], [0.14, 0.12, 0.09]]) ellipse(hx + dx, dy, r, r);
      }
      break;
    case 'fridge':
      line(-hw, hl - 0.03, hw, hl - 0.03);
      line(-hw + 0.04, -hl + 0.04, hw - 0.04, hl - 0.07);
      line(hw - 0.04, -hl + 0.04, -hw + 0.04, hl - 0.07);
      break;
    case 'toilet': {
      const tank = Math.min(0.18, L * 0.3);
      const rz = (L - tank) / 2;
      ellipse(0, -hl + tank + rz - 0.02, hw * 0.9, rz * 0.95);
      ellipse(0, -hl + tank + rz, hw * 0.6, rz * 0.65);
      break;
    }
    case 'bathtub': {
      const rim = Math.min(0.08, W * 0.08, L * 0.15);
      rect(-hw + rim, -hl + rim, hw - rim, hl - rim, Math.min(0.2, L * 0.3));
      ellipse(-hw + rim + 0.1, 0, 0.025, 0.025);
      break;
    }
    case 'shower':
      line(-hw, -hl, hw, hl);
      line(hw, -hl, -hw, hl);
      ellipse(0, 0, 0.04, 0.04);
      break;
    case 'washbasin':
      ellipse(0, hl * 0.1, hw * 0.7, hl * 0.6);
      ellipse(0, -hl + 0.06, 0.02, 0.02);
      break;
    case 'rug': {
      const border = Math.min(0.08, W * 0.1, L * 0.1);
      ctx.setLineDash([4 * px, 3 * px]);
      rect(-hw + border, -hl + border, hw - border, hl - border);
      ctx.setLineDash([]);
      break;
    }
    case 'plant': {
      const r = m / 2;
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        line(0, 0, Math.cos(a) * r * 0.9, Math.sin(a) * r * 0.9);
      }
      ellipse(0, 0, r * 0.45, r * 0.45);
      break;
    }
    case 'floorLamp':
      ellipse(0, 0, m * 0.32, m * 0.32);
      line(-m * 0.5, 0, m * 0.5, 0);
      line(0, -m * 0.5, 0, m * 0.5);
      break;
  }
}

/** Round pieces get a round outline on the plan. */
export const isRound = (f: Furniture) => f.kind === 'plant' || f.kind === 'floorLamp';
