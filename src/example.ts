import { DEFAULTS, emptyPlan, newId, type Furniture, type OpeningKind, type Plan } from './model';
import { addWall, wallAt } from './ops';

/** A small single-story house to play with. */
export function examplePlan(): Plan {
  const plan = emptyPlan();
  const chain = (pts: [number, number][]) => {
    for (let i = 0; i < pts.length - 1; i++) {
      addWall(plan, { x: pts[i][0], y: pts[i][1] }, { x: pts[i + 1][0], y: pts[i + 1][1] });
    }
  };
  chain([
    [0, 0],
    [10, 0],
    [10, 8],
    [0, 8],
    [0, 0],
  ]);
  chain([
    [6, 0],
    [6, 8],
  ]);
  chain([
    [6, 4.5],
    [10, 4.5],
  ]);
  chain([
    [8, 4.5],
    [8, 8],
  ]);

  const opening = (kind: OpeningKind, x: number, y: number, width?: number, extra: Partial<{ sill: number; height: number; flipSwing: boolean; flipHinge: boolean }> = {}) => {
    const hit = wallAt(plan, { x, y }, 0.01);
    if (!hit) return;
    const d = DEFAULTS[kind];
    plan.openings.push({
      id: newId('o'),
      wallId: hit.wall.id,
      kind,
      offset: hit.along,
      width: width ?? d.width,
      height: extra.height ?? d.height,
      sill: extra.sill ?? d.sill,
      flipHinge: extra.flipHinge ?? false,
      flipSwing: extra.flipSwing ?? false,
    });
  };
  opening('door', 3, 8, 1.0);
  opening('door', 6, 2.5);
  opening('door', 7, 4.5, 0.8);
  opening('door', 9, 4.5, 0.8);
  opening('window', 1.8, 0, 1.4);
  opening('window', 4.2, 0, 1.4);
  opening('window', 8, 0, 1.6);
  opening('window', 10, 2.2);
  opening('window', 0, 4, 1.8);
  opening('window', 9, 8, 0.6, { sill: 1.4, height: 0.6 });
  opening('window', 7, 8, 0.9);

  const box = (name: string, x: number, y: number, width: number, length: number, height: number, color: string, rotation = 0): Furniture => ({
    id: newId('f'),
    name,
    x,
    y,
    width,
    length,
    height,
    elevation: 0,
    rotation,
    color,
  });
  plan.furniture.push(
    box('Sofa', 2.2, 3, 2.2, 0.9, 0.8, '#7d8fa6'),
    box('Coffee table', 2.2, 1.9, 1.1, 0.6, 0.45, '#a0785a'),
    box('Dining table', 3.6, 5.9, 1.6, 0.9, 0.75, '#a0785a'),
    box('Kitchen counter', 0.4, 6.2, 0.6, 3, 0.9, '#d9d4c7'),
    box('Bed', 8, 1.4, 1.6, 2.1, 0.55, '#c9b7a0'),
    box('Wardrobe', 8, 4, 1.8, 0.6, 2.1, '#8c6d53'),
  );
  return plan;
}
