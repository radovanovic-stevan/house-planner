import { emptyPlan, normalizePlan, type Plan, type Selection } from './model';

const STORAGE_KEY = 'house-planner:plan';
const NAME_KEY = 'house-planner:name';
const MAX_HISTORY = 200;

type Listener = () => void;

export type Tool = 'select' | 'wall' | 'door' | 'terraceDoor' | 'window' | 'tallWindow' | 'furniture';
export type ViewMode = '2d' | '3d';

export interface UiState {
  tool: Tool;
  view: ViewMode;
  /** Grid snapping step in meters (0 disables snapping). */
  snap: number;
}

/**
 * Holds the plan, the current selection and undo/redo history.
 * Mutations happen in place: call `checkpoint()` before a change you want to be undoable,
 * mutate `plan`, then `emit()`.
 */
export class Store {
  plan: Plan;
  /** Name of the plan file in the project's plans/ folder, or null for an unsaved plan. */
  planName: string | null = null;
  selection: Selection = null;
  ui: UiState = { tool: 'wall', view: '2d', snap: 0.1 };
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private listeners = new Set<Listener>();
  private saveTimer: number | undefined;

  constructor() {
    this.plan = this.load() ?? emptyPlan();
    try {
      this.planName = localStorage.getItem(NAME_KEY);
    } catch {
      /* storage unavailable */
    }
  }

  setPlanName(name: string | null) {
    this.planName = name;
    try {
      if (name) localStorage.setItem(NAME_KEY, name);
      else localStorage.removeItem(NAME_KEY);
    } catch {
      /* storage unavailable */
    }
    this.emit();
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    this.validateSelection();
    for (const fn of this.listeners) fn();
    this.scheduleSave();
  }

  checkpoint() {
    this.undoStack.push(JSON.stringify(this.plan));
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
    this.redoStack = [];
  }

  /** Discards the most recent checkpoint (e.g. a drag that didn't move anything). */
  dropCheckpoint() {
    this.undoStack.pop();
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }
  get canRedo() {
    return this.redoStack.length > 0;
  }

  undo() {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(JSON.stringify(this.plan));
    this.plan = JSON.parse(prev);
    this.emit();
  }

  redo() {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(JSON.stringify(this.plan));
    this.plan = JSON.parse(next);
    this.emit();
  }

  select(sel: Selection) {
    this.selection = sel;
    this.emit();
  }

  setUi(patch: Partial<UiState>) {
    Object.assign(this.ui, patch);
    this.emit();
  }

  /**
   * Switches to a different plan (and the file name it saves to). Clears undo history:
   * undoing into the previous plan would autosave its content into the new plan's file.
   */
  replacePlan(plan: Plan, name: string | null) {
    this.undoStack = [];
    this.redoStack = [];
    this.plan = normalizePlan(plan);
    this.selection = null;
    this.setPlanName(name);
  }

  private validateSelection() {
    const s = this.selection;
    if (!s) return;
    const list = s.kind === 'wall' ? this.plan.walls : s.kind === 'opening' ? this.plan.openings : this.plan.furniture;
    if (!list.some((x) => x.id === s.id)) this.selection = null;
  }

  private load(): Plan | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? normalizePlan(JSON.parse(raw)) : null;
    } catch {
      return null;
    }
  }

  private scheduleSave() {
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.plan));
      } catch {
        /* storage unavailable; ignore */
      }
    }, 300);
  }
}
