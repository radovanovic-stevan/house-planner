import { fmt, wallLength } from './geometry';
import { DEFAULTS, isDoor, newId, OPENING_KINDS, OPENING_LABELS, type Furniture, type Opening, type OpeningKind, type Wall } from './model';
import { clampOpening, clampOpeningsOnWall, deleteSelection, getWall, setWallLength } from './ops';
import { findRooms } from './rooms';
import type { Store } from './store';

interface NumberField {
  key: string;
  label: string;
  get: () => number;
  set: (v: number) => void;
  min?: number;
  step?: number;
  unit?: string;
}

/** The right-hand properties panel: edits the selected item, or shows a plan summary. */
export class Panel {
  private renderedFor = '';
  /** Undo/redo swap in a new plan object; fields holding old objects must be rebuilt. */
  private renderedPlan: unknown = null;

  constructor(
    private root: HTMLElement,
    private store: Store,
  ) {
    store.subscribe(() => this.update());
    this.update();
  }

  private update() {
    const sel = this.store.selection;
    const key = sel ? `${sel.kind}:${sel.id}` : `none:${this.store.ui.view}`;
    if (key !== this.renderedFor || this.store.plan !== this.renderedPlan) {
      this.renderedFor = key;
      this.renderedPlan = this.store.plan;
      this.render();
    } else {
      this.refreshValues();
    }
  }

  /** Change wrapper: makes the edit undoable and notifies listeners. */
  private change(fn: () => void) {
    this.store.checkpoint();
    fn();
    this.store.emit();
  }

  private render() {
    const sel = this.store.selection;
    const plan = this.store.plan;
    this.root.innerHTML = '';
    this.getters.clear();
    if (sel?.kind === 'wall') {
      const w = getWall(plan, sel.id);
      if (w) return this.renderWall(w);
    }
    if (sel?.kind === 'opening') {
      const o = plan.openings.find((x) => x.id === sel.id);
      if (o) return this.renderOpening(o);
    }
    if (sel?.kind === 'furniture') {
      const f = plan.furniture.find((x) => x.id === sel.id);
      if (f) return this.renderFurniture(f);
    }
    this.renderSummary();
  }

  private refreshValues() {
    for (const input of this.root.querySelectorAll<HTMLInputElement>('input[data-key]')) {
      if (input === document.activeElement) continue;
      const v = this.getters.get(input.dataset.key!)?.();
      if (v === undefined) continue;
      if (input.type === 'checkbox') input.checked = !!v;
      else input.value = typeof v === 'number' ? fmt(v, 3) : String(v);
    }
    const summary = this.root.querySelector('[data-summary]');
    if (summary) this.render();
  }

  private getters = new Map<string, () => number | string | boolean>();

  private heading(title: string, subtitle?: string) {
    const h = document.createElement('div');
    h.className = 'panel-head';
    h.innerHTML = `<h2></h2>${subtitle ? '<p></p>' : ''}`;
    h.querySelector('h2')!.textContent = title;
    if (subtitle) h.querySelector('p')!.textContent = subtitle;
    this.root.append(h);
  }

  private section(): HTMLElement {
    const s = document.createElement('div');
    s.className = 'fields';
    this.root.append(s);
    return s;
  }

  private numberField(parent: HTMLElement, f: NumberField) {
    this.getters.set(f.key, f.get);
    const row = document.createElement('label');
    row.className = 'field';
    row.innerHTML = `<span></span><div class="input-unit"><input type="number" /><em></em></div>`;
    row.querySelector('span')!.textContent = f.label;
    row.querySelector('em')!.textContent = f.unit ?? 'm';
    const input = row.querySelector('input')!;
    input.dataset.key = f.key;
    input.step = String(f.step ?? 0.05);
    if (f.min !== undefined) input.min = String(f.min);
    input.value = fmt(f.get(), 3);
    input.addEventListener('change', () => {
      let v = parseFloat(input.value);
      if (!Number.isFinite(v)) {
        input.value = fmt(f.get(), 3);
        return;
      }
      if (f.min !== undefined) v = Math.max(f.min, v);
      this.change(() => f.set(v));
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') input.blur();
    });
    parent.append(row);
  }

  private checkbox(parent: HTMLElement, key: string, label: string, get: () => boolean, set: (v: boolean) => void) {
    this.getters.set(key, get);
    const row = document.createElement('label');
    row.className = 'field check';
    row.innerHTML = `<input type="checkbox" /><span></span>`;
    row.querySelector('span')!.textContent = label;
    const input = row.querySelector('input')!;
    input.dataset.key = key;
    input.checked = get();
    input.addEventListener('change', () => this.change(() => set(input.checked)));
    parent.append(row);
  }

  private select(parent: HTMLElement, label: string, options: [string, string][], get: () => string, set: (v: string) => void) {
    const row = document.createElement('label');
    row.className = 'field wide';
    row.innerHTML = `<span></span><select></select>`;
    row.querySelector('span')!.textContent = label;
    const input = row.querySelector('select')!;
    for (const [value, text] of options) input.add(new Option(text, value, false, value === get()));
    input.addEventListener('change', () => this.change(() => set(input.value)));
    parent.append(row);
  }

  private buttons(defs: [string, () => void, string?][]) {
    const row = document.createElement('div');
    row.className = 'panel-actions';
    for (const [label, fn, cls] of defs) {
      const b = document.createElement('button');
      b.textContent = label;
      if (cls) b.className = cls;
      b.addEventListener('click', fn);
      row.append(b);
    }
    this.root.append(row);
  }

  private deleteSelected = () => {
    const sel = this.store.selection;
    if (!sel) return;
    this.change(() => deleteSelection(this.store.plan, sel.kind, sel.id));
  };

  private renderWall(w: Wall) {
    const plan = this.store.plan;
    const openings = plan.openings.filter((o) => o.wallId === w.id).length;
    this.heading('Wall', openings ? `${openings} opening${openings > 1 ? 's' : ''}` : undefined);
    const s = this.section();
    this.numberField(s, { key: 'len', label: 'Length', get: () => wallLength(w), set: (v) => setWallLength(plan, w, v), min: 0.05 });
    this.numberField(s, { key: 'thk', label: 'Thickness', get: () => w.thickness, set: (v) => ((w.thickness = v), clampOpeningsOnWall(plan, w.id)), min: 0.02, step: 0.01 });
    this.numberField(s, { key: 'hgt', label: 'Height', get: () => w.height, set: (v) => (w.height = v), min: 0.1, step: 0.1 });
    this.buttons([
      [
        'Apply to all walls',
        () =>
          this.change(() => {
            for (const other of plan.walls) {
              other.thickness = w.thickness;
              other.height = w.height;
            }
          }),
      ],
      ['Delete', this.deleteSelected, 'danger'],
    ]);
  }

  private renderOpening(o: Opening) {
    const plan = this.store.plan;
    this.heading(OPENING_LABELS[o.kind]);
    const s = this.section();
    this.select(
      s,
      'Type',
      OPENING_KINDS.map((k) => [k, OPENING_LABELS[k]]),
      () => o.kind,
      (v) => {
        const kind = v as OpeningKind;
        o.kind = kind;
        o.height = DEFAULTS[kind].height;
        o.sill = DEFAULTS[kind].sill;
        this.renderedFor = '';
      },
    );
    this.numberField(s, { key: 'w', label: 'Width', get: () => o.width, set: (v) => ((o.width = v), clampOpening(plan, o)), min: 0.1 });
    this.numberField(s, { key: 'h', label: 'Height', get: () => o.height, set: (v) => (o.height = v), min: 0.1 });
    this.numberField(s, { key: 's', label: isDoor(o.kind) ? 'Threshold' : 'Sill height', get: () => o.sill, set: (v) => (o.sill = v), min: 0 });
    this.numberField(s, {
      key: 'off',
      label: 'From wall start',
      get: () => o.offset - o.width / 2,
      set: (v) => ((o.offset = v + o.width / 2), clampOpening(plan, o)),
      min: 0,
    });
    if (isDoor(o.kind)) {
      this.checkbox(s, 'fh', 'Flip hinge side', () => o.flipHinge, (v) => (o.flipHinge = v));
      this.checkbox(s, 'fs', 'Flip swing direction', () => o.flipSwing, (v) => (o.flipSwing = v));
    }
    if (o.kind === 'tallWindow') {
      const w = getWall(plan, o.wallId);
      if (w) this.buttons([['Up to the ceiling', () => this.change(() => ((o.sill = 0), (o.height = w.height)))]]);
    }
    this.buttons([['Delete', this.deleteSelected, 'danger']]);
  }

  private renderFurniture(f: Furniture) {
    this.heading('Box');
    const s = this.section();
    const nameRow = document.createElement('label');
    nameRow.className = 'field';
    nameRow.innerHTML = `<span>Name</span><input type="text" />`;
    const nameInput = nameRow.querySelector('input')!;
    nameInput.value = f.name;
    nameInput.addEventListener('change', () => this.change(() => (f.name = nameInput.value.trim() || 'Box')));
    s.append(nameRow);

    this.numberField(s, { key: 'fw', label: 'Width', get: () => f.width, set: (v) => (f.width = v), min: 0.01 });
    this.numberField(s, { key: 'fl', label: 'Length', get: () => f.length, set: (v) => (f.length = v), min: 0.01 });
    this.numberField(s, { key: 'fh', label: 'Height', get: () => f.height, set: (v) => (f.height = v), min: 0.01 });
    this.numberField(s, { key: 'fe', label: 'Lifted off floor', get: () => f.elevation, set: (v) => (f.elevation = v), min: 0 });
    this.numberField(s, { key: 'fr', label: 'Rotation', get: () => f.rotation, set: (v) => (f.rotation = ((v % 360) + 360) % 360), step: 15, unit: '°' });
    this.numberField(s, { key: 'fx', label: 'Position x', get: () => f.x, set: (v) => (f.x = v) });
    this.numberField(s, { key: 'fy', label: 'Position y', get: () => f.y, set: (v) => (f.y = v) });

    const colorRow = document.createElement('label');
    colorRow.className = 'field';
    colorRow.innerHTML = `<span>Color</span><input type="color" />`;
    const colorInput = colorRow.querySelector('input')!;
    colorInput.value = f.color;
    colorInput.addEventListener('change', () => this.change(() => (f.color = colorInput.value)));
    s.append(colorRow);

    this.buttons([
      ['Rotate 90°', () => this.change(() => (f.rotation = (f.rotation + 90) % 360))],
      [
        'Duplicate',
        () => {
          const copy: Furniture = { ...f, id: newId('f'), x: f.x + 0.3, y: f.y + 0.3 };
          this.change(() => {
            this.store.plan.furniture.push(copy);
            this.store.selection = { kind: 'furniture', id: copy.id };
          });
        },
      ],
      ['Delete', this.deleteSelected, 'danger'],
    ]);
  }

  private renderSummary() {
    const plan = this.store.plan;
    const rooms = findRooms(plan);
    const total = rooms.reduce((s, r) => s + r.area, 0);
    this.heading('Plan');
    const box = document.createElement('div');
    box.className = 'summary';
    box.dataset.summary = '';
    const doors = plan.openings.filter((o) => isDoor(o.kind)).length;
    const windows = plan.openings.length - doors;
    box.innerHTML = `
      <div class="stat-grid">
        <div><b>${fmt(total, 1)}</b><span>m² floor</span></div>
        <div><b>${rooms.length}</b><span>rooms</span></div>
        <div><b>${doors}</b><span>doors</span></div>
        <div><b>${windows}</b><span>windows</span></div>
      </div>
      ${
        rooms.length
          ? `<ol class="room-list">${rooms
              .slice()
              .sort((a, b) => b.area - a.area)
              .map((r) => `<li><span>Room</span><b>${fmt(r.area)} m²</b></li>`)
              .join('')}</ol>`
          : ''
      }`;
    this.root.append(box);

    const help = document.createElement('div');
    help.className = 'help';
    help.innerHTML =
      this.store.ui.view === '2d'
        ? `
      <h3>Drawing</h3>
      <ul>
        <li><kbd>W</kbd> Wall: click to start, click to add corners. Walls are always horizontal or vertical. Type a number + <kbd>Enter</kbd> for an exact length. Finish with <kbd>Esc</kbd>, double-click or right-click; clicking the start point closes the room.</li>
        <li><kbd>D</kbd> Door / <kbd>T</kbd> Terrace door / <kbd>N</kbd> Window / <kbd>G</kbd> Floor-to-ceiling window: click on a wall.</li>
        <li><kbd>B</kbd> Box: click to place furniture.</li>
        <li><kbd>V</kbd> Select: drag walls, corners, openings and boxes. Dragging a corner moves the wall lines through it. <kbd>Del</kbd> removes.</li>
      </ul>
      <h3>View</h3>
      <ul>
        <li>Scroll / pinch to zoom. Drag empty space, middle mouse or <kbd>Space</kbd>+drag to pan.</li>
        <li><kbd>⌘Z</kbd> undo, <kbd>⇧⌘Z</kbd> redo.</li>
      </ul>`
        : `
      <h3>3D view</h3>
      <ul>
        <li>Left-drag to orbit, right-drag to pan, scroll to zoom. <kbd>C</kbd> toggles cutaway walls.</li>
        <li><kbd>B</kbd> Box: click the floor to place furniture.</li>
        <li>Click a box to select it, drag it to move. <kbd>R</kbd> rotates 90°, <kbd>Del</kbd> removes.</li>
        <li>Set exact sizes in this panel.</li>
      </ul>`;
    this.root.append(help);
  }
}
