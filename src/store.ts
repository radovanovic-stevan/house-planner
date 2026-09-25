import { emptyPlan, normalizePlan, type Plan, type Selection } from './model';

const STORAGE_KEY = 'house-planner:plan';
const MAX_HISTORY = 200;

type Listener = () => void;

/**
 * Holds the plan, the current selection and undo/redo history.
 * Mutations happen in place: call `checkpoint()` before a change you want to be undoable,
 * mutate `plan`, then `emit()`.
 */
export class Store {
  plan: Plan;
  selection: Selection = null;
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private listeners = new Set<Listener>();
  private saveTimer: number | undefined;

  constructor() {
    this.plan = this.load() ?? emptyPlan();
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

  replacePlan(plan: Plan) {
    this.checkpoint();
    this.plan = normalizePlan(plan);
    this.selection = null;
    this.emit();
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
