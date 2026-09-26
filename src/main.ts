import './style.css';
import { Editor2D } from './editor2d';
import { examplePlan } from './example';
import { emptyPlan, normalizePlan, type Plan } from './model';
import { deleteSelection } from './ops';
import { Panel } from './panel';
import {
  detectPlansMode,
  listPlans,
  listPublishedPlans,
  loadPlan,
  loadPublishedPlan,
  PLAN_NAME_RE,
  ProjectAutosave,
  type PlansMode,
} from './projectPlans';
import { Store, type Tool, type ViewMode } from './store';
import { View3D } from './view3d';

const store = new Store();
const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

const editor = new Editor2D($<HTMLCanvasElement>('#plan'), store);
const view3d = new View3D($('#view3d'), store);
new Panel($('#panel'), store);

const statusLeft = $('#status-left');
const statusRight = $('#status-right');
editor.onStatus = (t) => (statusLeft.textContent = t);

// ---------- toolbar ----------

const toolButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-tool]')];
const viewButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-view]')];

for (const b of toolButtons) b.addEventListener('click', () => setTool(b.dataset.tool as Tool));
for (const b of viewButtons) b.addEventListener('click', () => setView(b.dataset.view as ViewMode));

function setTool(tool: Tool) {
  const btn = toolButtons.find((b) => b.dataset.tool === tool);
  if (btn?.disabled) return;
  store.setUi({ tool });
}

function setView(view: ViewMode) {
  if (view === store.ui.view) return;
  const patch: Partial<typeof store.ui> = { view };
  // drawing tools only exist on the plan
  if (view === '3d' && ['wall', 'door', 'terraceDoor', 'window', 'tallWindow'].includes(store.ui.tool)) patch.tool = 'select';
  store.setUi(patch);
}

const snapSelect = $<HTMLSelectElement>('#snap');
snapSelect.value = String(store.ui.snap);
snapSelect.addEventListener('change', () => store.setUi({ snap: parseFloat(snapSelect.value) }));

$('#undo').addEventListener('click', () => store.undo());
$('#redo').addEventListener('click', () => store.redo());
$('#fit').addEventListener('click', () => (store.ui.view === '2d' ? editor.zoomToFit() : view3d.frame(false)));

// ---------- plans ----------
// Under the dev server, plans are files in the project's plans/ folder and autosave there.
// On a static deploy (GitHub Pages), plans committed to the repo can be opened as an
// editable copy that lives in the browser; Save as… downloads a file.

const autosave = new ProjectAutosave(store);
const planLabel = $('#plan-name');
const saveAsButton = $<HTMLButtonElement>('#save-as');
let mode: PlansMode = 'none';
/** On a static deploy: the published plan the browser copy was opened from. */
let publishedFrom: string | null = null;

function syncPlanLabel() {
  const name = store.planName;
  if (mode !== 'project') {
    planLabel.className = 'plan-name';
    planLabel.textContent = publishedFrom ? `${publishedFrom} · browser copy` : 'Saved in this browser';
    planLabel.title = 'Changes are kept in this browser. Use Download to keep a file.';
    return;
  }
  const state = autosave.state;
  planLabel.className = `plan-name ${name ? state : 'unsaved'}`;
  planLabel.textContent = !name
    ? 'Unsaved plan'
    : state === 'saving'
      ? `${name} · saving…`
      : state === 'error'
        ? `${name} · save failed`
        : `${name} · saved`;
  planLabel.title = name ? `plans/${name}.json` : 'Use "Save as…" to save this plan in the project';
}
autosave.onChange = syncPlanLabel;
store.subscribe(syncPlanLabel);

/** True if it's fine to replace the current plan. Named project plans are already on disk. */
function okToDiscard(what: string) {
  if ((mode === 'project' && store.planName) || (!store.plan.walls.length && !store.plan.furniture.length)) return true;
  const where = mode === 'project' ? "hasn't been saved" : 'is only kept in this browser';
  return confirm(`${what}? The current plan ${where} and will be replaced.`);
}

function openPlan(plan: Plan, name: string | null) {
  if (name) autosave.markSaved(JSON.stringify(normalizePlan(plan)));
  store.replacePlan(plan, name);
  editor.zoomToFit();
}

function download() {
  const blob = new Blob([JSON.stringify(store.plan, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${store.planName ?? publishedFrom ?? 'house-plan'}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function saveAs() {
  if (mode !== 'project') return download();
  const name = prompt('Save plan as (letters, numbers, spaces, - and _):', store.planName ?? 'My house')?.trim();
  if (!name) return;
  if (!PLAN_NAME_RE.test(name)) return alert('Please use only letters, numbers, spaces, - and _.');
  if (name !== store.planName) {
    const exists = (await listPlans()).some((p) => p.name === name);
    if (exists && !confirm(`A plan named "${name}" already exists. Overwrite it?`)) return;
  }
  store.setPlanName(name);
  await autosave.saveNow();
}

$('#new').addEventListener('click', () => {
  if (!okToDiscard('Start a new plan')) return;
  publishedFrom = null;
  store.replacePlan(emptyPlan(), null);
  store.setUi({ tool: 'wall' });
});
$('#example').addEventListener('click', () => {
  if (!okToDiscard('Load the example house')) return;
  publishedFrom = null;
  openPlan(examplePlan(), null);
});
saveAsButton.addEventListener('click', saveAs);

async function openPublished(name: string) {
  const plan = await loadPublishedPlan(name).catch(() => null);
  if (!plan) return alert(`Could not open "${name}".`);
  publishedFrom = name;
  openPlan(plan, null);
}

const openDialog = $<HTMLDialogElement>('#open-dialog');
const planList = $('#plan-list');
$('#open').addEventListener('click', async () => {
  planList.innerHTML = '';
  $('#open-sub').innerHTML =
    mode === 'project'
      ? "Plans saved in the project's <code>plans/</code> folder"
      : mode === 'published'
        ? 'Plans published with this site. Opening one gives you an editable copy in this browser.'
        : 'Plans are kept in this browser. Import a <code>.json</code> file to open one.';
  const plans = mode === 'project' ? await listPlans().catch(() => []) : mode === 'published' ? await listPublishedPlans().catch(() => []) : [];
  if (mode !== 'none' && !plans.length) {
    planList.innerHTML = `<li class="empty">${mode === 'project' ? 'No saved plans yet. Use "Save as…" to add one.' : 'No plans have been published yet.'}</li>`;
  }
  planList.hidden = mode === 'none';
  for (const p of plans) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.innerHTML = '<b></b><span></span>';
    b.querySelector('b')!.textContent = p.name;
    b.querySelector('span')!.textContent = new Date(p.updated).toLocaleString();
    if (p.name === (mode === 'project' ? store.planName : publishedFrom)) b.classList.add('active');
    b.addEventListener('click', async () => {
      if (!okToDiscard(`Open "${p.name}"`)) return;
      if (mode === 'published') {
        openDialog.close();
        return openPublished(p.name);
      }
      const plan = await loadPlan(p.name).catch(() => null);
      if (!plan) return alert(`Could not open "${p.name}".`);
      openDialog.close();
      openPlan(plan, p.name);
    });
    li.append(b);
    planList.append(li);
  }
  openDialog.showModal();
});
$('#download').addEventListener('click', download);

const fileInput = $<HTMLInputElement>('#file');
$('#import').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  fileInput.value = '';
  if (!file) return;
  if (!okToDiscard(`Import "${file.name}"`)) return;
  try {
    const plan = normalizePlan(JSON.parse(await file.text()));
    openDialog.close();
    publishedFrom = null;
    openPlan(plan, null);
  } catch {
    alert('That file could not be read as a house plan.');
  }
});

detectPlansMode().then(async (m) => {
  mode = m;
  if (mode === 'project') {
    // The plan file is the source of truth (it may have changed, e.g. after a git pull);
    // fall back to the browser copy if it's missing.
    const name = store.planName;
    if (name) {
      const plan = await loadPlan(name).catch(() => null);
      if (plan) openPlan(plan, name);
      else await autosave.saveNow();
    }
  } else {
    // no project folder to write to
    if (store.planName) store.setPlanName(null);
    saveAsButton.textContent = 'Download';
    saveAsButton.title = 'Download this plan as a .json file (⌘S)';
    // first visit: show the most recently published plan
    if (mode === 'published' && !store.plan.walls.length && !store.plan.furniture.length) {
      const latest = (await listPublishedPlans().catch(() => []))[0];
      if (latest) await openPublished(latest.name);
    }
  }
  syncPlanLabel();
});

function syncToolbar() {
  const { tool, view } = store.ui;
  for (const b of toolButtons) {
    b.classList.toggle('active', b.dataset.tool === tool);
    b.disabled = !!b.dataset.only && b.dataset.only !== view;
  }
  for (const b of viewButtons) b.classList.toggle('active', b.dataset.view === view);
  $<HTMLButtonElement>('#undo').disabled = !store.canUndo;
  $<HTMLButtonElement>('#redo').disabled = !store.canRedo;
  $('#plan').hidden = view !== '2d';
  $('#view3d').hidden = view !== '3d';
  const { walls, furniture } = store.plan;
  statusRight.textContent = `${walls.length} walls · ${furniture.length} boxes`;
}
store.subscribe(syncToolbar);
syncToolbar();

// ---------- keyboard ----------

const shortcuts: Record<string, Tool> = { v: 'select', w: 'wall', d: 'door', t: 'terraceDoor', n: 'window', g: 'tallWindow', b: 'furniture' };

function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement;
  return t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA';
}

window.addEventListener('keydown', (e) => {
  if (isTyping(e)) return;
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    if (e.shiftKey) store.redo();
    else store.undo();
    return;
  }
  if (mod && e.key.toLowerCase() === 's') {
    e.preventDefault();
    if (store.planName && mode === 'project') autosave.saveNow();
    else saveAs();
    return;
  }
  if (mod && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    store.redo();
    return;
  }
  if (mod) return;
  if (store.ui.view === '2d' && editor.handleKey(e, true)) {
    e.preventDefault();
    return;
  }
  const key = e.key.toLowerCase();
  if (shortcuts[key]) {
    setTool(shortcuts[key]);
    return;
  }
  if (key === 'f') {
    if (store.ui.view === '2d') editor.zoomToFit();
    else view3d.frame(false);
  }
  if (key === 'c' && store.ui.view === '3d') view3d.toggleCutaway();
  if (e.key === 'Escape') {
    if (store.selection) store.select(null);
    else setTool('select');
  }
  const sel = store.selection;
  if ((e.key === 'Delete' || e.key === 'Backspace') && sel) {
    e.preventDefault();
    store.checkpoint();
    deleteSelection(store.plan, sel.kind, sel.id);
    store.emit();
  }
  if (key === 'r' && sel?.kind === 'furniture') {
    const f = store.plan.furniture.find((x) => x.id === sel.id);
    if (f) {
      store.checkpoint();
      f.rotation = (f.rotation + (e.shiftKey ? 15 : 90)) % 360;
      store.emit();
    }
  }
});
window.addEventListener('keyup', (e) => {
  if (!isTyping(e) && store.ui.view === '2d') editor.handleKey(e, false);
});
