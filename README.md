# House Planner

Draw a single-story floor plan in 2D, then walk around it in 3D and furnish it: sofas, beds, tables, wardrobes, a kitchen, a bathroom and more.

```sh
npm install
npm run dev      # http://localhost:5173
npm run build    # typecheck + production build into dist/
```

## Using it

**2D plan**

- `W` **Wall**: click to start, click to add corners. Walls are always horizontal or vertical. Type a number and press `Enter` for an exact length in meters. `Esc`, a double-click or a right-click ends the chain. Clicking the start point closes the room.
- `D` **Door** / `N` **Window**: click on a wall.
- `T` **Terrace door**: a glazed door out to a balcony or terrace. `G` **Tall window**: a floor-to-ceiling window (no sill). Click on a wall. The panel's **Type** menu switches any opening between door, terrace door, window and floor-to-ceiling window.
- `A` **Terrace**: drag out a terrace or balcony. Its edges snap to wall faces. It's drawn hatched with its size, shows as a tiled slab in 3D and is listed as outdoor area, not counted in the floor total. The panel switches it between terrace and balcony and sets exact sizes; drag its corner handles to resize.
- `B` **Furniture**: pick an item in the toolbar's **Item** menu (sofa, armchair, bed, nightstand, tables, chair, desk, wardrobe, bookshelf, TV unit, kitchen counter, fridge, toilet, bathtub, shower, washbasin, rug, plant, floor lamp or a plain box), then click to place it. Each one is drawn with its own plan symbol and shows as a real model in 3D, built to the size you set. The panel's **Type** menu switches a placed piece to another item. The front of a piece faces down on the plan before it's rotated.
- `V` **Select**: drag corners (the wall lines through a corner move with it, so walls stay straight), whole walls (joined walls stretch), openings along walls, and furniture. `Del` removes the selected item and the panel on the right edits exact sizes.
- Closed rooms show their net floor area (inside the walls) in m².
- Scroll or pinch to zoom. Drag empty space, use the middle mouse or hold `Space` and drag to pan. `F` zooms to fit.

**3D view**

- Left-drag orbits, right-drag pans and scrolling zooms.
- `B` then click the floor to place the item picked in the toolbar. Click a piece to select it and drag it to move it. `R` rotates it 90° (`Shift+R` rotates 15°).
- `C` toggles cutaway walls so rooms are visible from above.
- **Walk inside** (`P`) puts you in the house at eye height (1.6 m), or double-click the floor to start walking there. Use `WASD` or the arrow keys to move, the mouse to look and `Shift` to run. `Esc` returns to the orbit camera. Walls, windows and furniture block you, and doors let you through. Walking needs a keyboard and a mouse or trackpad, so it's hidden on phones and tablets.

`⌘Z` / `⇧⌘Z` undo and redo.

## Saving plans

Plans are saved as JSON files in the project's `plans/` folder, so they can be committed with the code.

- **Save as…** (`⌘S` on an unnamed plan) names the plan and writes `plans/<name>.json`. After that, every change autosaves to that file. The toolbar shows the plan's name and whether it's saved.
- **Open…** lists the plans in `plans/`. It can also import or download a `.json` file.
- On startup the app reopens the last plan from its file, so changes from `git pull` show up.
- Saving to the project goes through the dev server (`npm run dev`).

## GitHub Pages

Every push to `main` deploys to https://radovanovic-stevan.github.io/house-planner/ (see `.github/workflows/deploy.yml`).

The hosted site is **view only**: the editing tools, undo/redo, New and Save as are hidden, and plans can't be changed there. Plans are edited locally with `npm run dev`.

- Plans committed in `plans/` are published with the site. **Open…** switches between them.
- It reopens the plan the visitor looked at last, or the most recently committed plan on a first visit.
- 2D: drag to pan and scroll to zoom. 3D: orbit, cutaway and walk inside all work.
- **Example** shows the demo house, and the Open dialog can still view an imported `.json` file or download the current plan.

Any production build is view only (`src/env.ts`), including `npm run preview`.

To publish a plan, save it locally with `npm run dev`, then commit and push the file in `plans/`.

## Code map

| File | What it does |
| --- | --- |
| `src/model.ts` | Plan data types (walls, openings, furniture, terrace/balcony areas), defaults, JSON validation |
| `src/store.ts` | State, selection, UI mode, undo/redo, localStorage autosave |
| `src/ops.ts` | Wall operations; walls stay split at junctions so they form a planar graph |
| `src/rooms.ts` | Room detection (faces of the wall graph) and net area |
| `src/editor2d.ts` | Canvas plan editor: rendering, snapping, tools |
| `src/view3d.ts` | three.js scene built from the plan, furniture picking and dragging |
| `src/panel.ts` | Properties panel and plan summary |
| `src/projectPlans.ts` | Client for the `plans/` API, and autosave to the current plan file |
| `vite.config.ts` | Dev server plugin serving `/api/plans` from the `plans/` folder |
