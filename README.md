# House Planner

Draw a single-story floor plan in 2D, then walk around it in 3D and place furniture boxes.

```sh
npm install
npm run dev      # http://localhost:5173
npm run build    # typecheck + production build into dist/
```

## Using it

**2D plan**

- `W` **Wall**: click to start, click to add corners. Walls are always horizontal or vertical. Type a number and press `Enter` for an exact length in meters. `Esc`, a double-click or a right-click ends the chain. Clicking the start point closes the room.
- `D` **Door** / `N` **Window**: click on a wall.
- `B` **Box**: click to place a furniture box.
- `V` **Select**: drag corners (the wall lines through a corner move with it, so walls stay straight), whole walls (joined walls stretch), openings along walls, and boxes. `Del` removes the selected item and the panel on the right edits exact sizes.
- Closed rooms show their net floor area (inside the walls) in m².
- Scroll or pinch to zoom. Drag empty space, use the middle mouse or hold `Space` and drag to pan. `F` zooms to fit.

**3D view**

- Left-drag orbits, right-drag pans and scrolling zooms.
- `B` then click the floor to place a box. Click a box to select it and drag it to move it. `R` rotates it 90° (`Shift+R` rotates 15°).
- `C` toggles cutaway walls so rooms are visible from above.

`⌘Z` / `⇧⌘Z` undo and redo.

## Saving plans

Plans are saved as JSON files in the project's `plans/` folder, so they can be committed with the code.

- **Save as…** (`⌘S` on an unnamed plan) names the plan and writes `plans/<name>.json`. After that, every change autosaves to that file. The toolbar shows the plan's name and whether it's saved.
- **Open…** lists the plans in `plans/`. It can also import or download a `.json` file.
- On startup the app reopens the last plan from its file, so changes from `git pull` show up.
- Saving to the project goes through the dev server (`npm run dev` or `npm run preview`).

## GitHub Pages

Every push to `main` deploys to https://radovanovic-stevan.github.io/house-planner/ (see `.github/workflows/deploy.yml`).

The hosted site can't write to the repo, so plans work differently there:

- Plans committed in `plans/` are published with the site. **Open…** lists them, and opening one gives an editable copy that is kept in that browser.
- On a first visit, the most recently committed plan opens automatically.
- **Download** saves the current plan as a `.json` file.

To publish a plan, save it locally with `npm run dev`, then commit and push the file in `plans/`.

## Code map

| File | What it does |
| --- | --- |
| `src/model.ts` | Plan data types (walls, openings, furniture), defaults, JSON validation |
| `src/store.ts` | State, selection, UI mode, undo/redo, localStorage autosave |
| `src/ops.ts` | Wall operations; walls stay split at junctions so they form a planar graph |
| `src/rooms.ts` | Room detection (faces of the wall graph) and net area |
| `src/editor2d.ts` | Canvas plan editor: rendering, snapping, tools |
| `src/view3d.ts` | three.js scene built from the plan, furniture picking and dragging |
| `src/panel.ts` | Properties panel and plan summary |
| `src/projectPlans.ts` | Client for the `plans/` API, and autosave to the current plan file |
| `vite.config.ts` | Dev server plugin serving `/api/plans` from the `plans/` folder |
