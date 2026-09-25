# House Planner

Draw a single-story floor plan in 2D, then walk around it in 3D and place furniture boxes.

```sh
npm install
npm run dev      # http://localhost:5173
npm run build    # typecheck + production build into dist/
```

## Using it

**2D plan**

- `W` **Wall**: click to start, click to add corners. Type a number and press `Enter` for an exact length in meters, and hold `Shift` to lock to 45°. `Esc`, a double-click or a right-click ends the chain. Clicking the start point closes the room.
- `D` **Door** / `N` **Window**: click on a wall.
- `B` **Box**: click to place a furniture box.
- `V` **Select**: drag corners, whole walls (joined walls stretch), openings along walls, and boxes. `Del` removes the selected item and the panel on the right edits exact sizes.
- Closed rooms show their net floor area (inside the walls) in m².
- Scroll or pinch to zoom. Drag empty space, use the middle mouse or hold `Space` and drag to pan. `F` zooms to fit.

**3D view**

- Left-drag orbits, right-drag pans and scrolling zooms.
- `B` then click the floor to place a box. Click a box to select it and drag it to move it. `R` rotates it 90° (`Shift+R` rotates 15°).
- `C` toggles cutaway walls so rooms are visible from above.

The plan autosaves in the browser. **Save…** and **Open…** export and import it as JSON. `⌘Z` / `⇧⌘Z` undo and redo.

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
