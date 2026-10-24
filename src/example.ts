import { DEFAULTS, emptyPlan, newFurniture, newId, type Furniture, type FurnitureKind, type OpeningKind, type Plan } from './model';
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

  // rotation turns a piece's front (down on the plan at 0°): 90° faces left, 180° up, 270° right
  const put = (kind: FurnitureKind, x: number, y: number, rotation = 0, size: Partial<Pick<Furniture, 'width' | 'length' | 'height'>> = {}) =>
    plan.furniture.push({ ...newFurniture(kind, { x, y }, plan.furniture), rotation, ...size });

  // living room
  put('rug', 2.4, 1.8, 90);
  put('tvUnit', 0.33, 1.8, 270);
  put('sofa', 3.6, 1.8, 90);
  put('coffeeTable', 2.2, 1.8, 90);
  put('armchair', 2.2, 3.15, 180);
  put('floorLamp', 3.7, 0.4);
  put('plant', 5.55, 0.45);
  // dining and kitchen
  put('diningTable', 3.6, 5.9);
  put('chair', 3.2, 5.25);
  put('chair', 4.0, 5.25);
  put('chair', 3.2, 6.55, 180);
  put('chair', 4.0, 6.55, 180);
  put('kitchenCounter', 0.4, 6.1, 270, { width: 2.2 });
  put('fridge', 0.425, 7.55, 270);
  put('plant', 5.55, 7.5);
  // bedroom
  put('bed', 8, 1.15, 0, { height: 0.9 });
  put('nightstand', 6.95, 0.33);
  put('nightstand', 9.05, 0.33);
  put('wardrobe', 8, 4.1, 180, { width: 1 });
  // study
  put('desk', 7, 7.55, 180);
  put('chair', 6.8, 6.95);
  put('bookshelf', 6.275, 5.5, 270);
  // bathroom
  put('bathtub', 9, 7.525, 180);
  put('toilet', 9.575, 5.6, 90);
  put('washbasin', 8.325, 5.8, 270);
  return plan;
}
