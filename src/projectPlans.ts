import { normalizePlan, type Plan } from './model';
import type { Store } from './store';

/**
 * Access to the project's `plans/` folder. Under the dev server it's read/write through
 * /api/plans (see vite.config.ts); a static build (GitHub Pages) ships a read-only copy
 * in plans/ next to index.html.
 */

export interface PlanEntry {
  name: string;
  updated: number;
}

export const PLAN_NAME_RE = /^[\w\- ]{1,80}$/;

/**
 * - `project`: dev server; plans are read and written in the project folder.
 * - `published`: static deploy; plans committed to the repo can be opened, not saved.
 * - `none`: neither (e.g. a static build with no plans); plans live in the browser only.
 */
export type PlansMode = 'project' | 'published' | 'none';

const PUBLISHED_DIR = `${import.meta.env.BASE_URL}plans/`;

const fetchJson = async (url: string) => {
  const r = await fetch(url);
  if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) throw new Error(`${url}: ${r.status}`);
  return r.json();
};

let mode: Promise<PlansMode> | null = null;

export function detectPlansMode(): Promise<PlansMode> {
  mode ??= fetchJson('/api/plans')
    .then(() => 'project' as const)
    .catch(() =>
      fetchJson(`${PUBLISHED_DIR}index.json`)
        .then(() => 'published' as const)
        .catch(() => 'none' as const),
    );
  return mode;
}

export async function listPublishedPlans(): Promise<PlanEntry[]> {
  return fetchJson(`${PUBLISHED_DIR}index.json`);
}

export async function loadPublishedPlan(name: string): Promise<Plan> {
  return normalizePlan(await fetchJson(`${PUBLISHED_DIR}${encodeURIComponent(name)}.json`));
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
