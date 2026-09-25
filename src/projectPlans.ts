import { normalizePlan, type Plan } from './model';
import type { Store } from './store';

/** Client for the dev server's `plans/` folder API (see vite.config.ts). */

export interface PlanEntry {
  name: string;
  updated: number;
}

export const PLAN_NAME_RE = /^[\w\- ]{1,80}$/;

let available: Promise<boolean> | null = null;

/** Whether the plans API exists (it does under `npm run dev` / `npm run preview`, not in a static build). */
export function plansApiAvailable(): Promise<boolean> {
  available ??= fetch('/api/plans')
    .then((r) => r.ok && (r.headers.get('content-type') ?? '').includes('json'))
    .catch(() => false);
  return available;
}

export async function listPlans(): Promise<PlanEntry[]> {
  const r = await fetch('/api/plans');
  if (!r.ok) throw new Error(`Could not list plans (${r.status})`);
  return r.json();
}

export async function loadPlan(name: string): Promise<Plan | null> {
  const r = await fetch(`/api/plans/${encodeURIComponent(name)}`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`Could not load "${name}" (${r.status})`);
  return normalizePlan(await r.json());
}

export async function savePlan(name: string, plan: Plan): Promise<void> {
  const r = await fetch(`/api/plans/${encodeURIComponent(name)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(plan),
  });
  if (!r.ok) throw new Error(`Could not save "${name}" (${r.status})`);
}

export type SaveState = 'unsaved' | 'saving' | 'saved' | 'error';

/**
 * Keeps the plan file in `plans/` up to date: whenever the plan has a name, every change
 * is written to `plans/<name>.json` shortly after it happens.
 */
export class ProjectAutosave {
  state: SaveState = 'unsaved';
  onChange: () => void = () => {};
  private lastSaved = '';
  private timer: number | undefined;
  private inFlight: Promise<void> = Promise.resolve();

  constructor(private store: Store) {
    store.subscribe(() => this.schedule());
  }

  /** Records `json` as what's on disk, e.g. right after loading a plan. */
  markSaved(json = JSON.stringify(this.store.plan)) {
    this.lastSaved = json;
    this.setState('saved');
  }

  /** Saves right away (used after naming a plan). */
  async saveNow() {
    window.clearTimeout(this.timer);
    await this.write();
  }

  private schedule() {
    if (!this.store.planName) return this.setState('unsaved');
    if (JSON.stringify(this.store.plan) === this.lastSaved) return;
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.write(), 600);
  }

  private write() {
    // chain writes so an older save can never land after a newer one
    this.inFlight = this.inFlight.then(async () => {
      const name = this.store.planName;
      if (!name) return;
      const json = JSON.stringify(this.store.plan);
      if (json === this.lastSaved) return this.setState('saved');
      this.setState('saving');
      try {
        await savePlan(name, JSON.parse(json));
        this.lastSaved = json;
        this.setState(JSON.stringify(this.store.plan) === json ? 'saved' : 'saving');
      } catch {
        this.setState('error');
      }
    });
    return this.inFlight;
  }

  private setState(s: SaveState) {
    this.state = s;
    this.onChange();
  }
}
