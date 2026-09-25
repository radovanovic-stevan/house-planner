import './style.css';
import { Editor2D } from './editor2d';
import { examplePlan } from './example';
import { emptyPlan, normalizePlan, type Plan } from './model';
import { deleteSelection } from './ops';
import { Panel } from './panel';
import { listPlans, loadPlan, PLAN_NAME_RE, plansApiAvailable, ProjectAutosave } from './projectPlans';
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
  if (view === '3d' && ['wall', 'door', 'window'].includes(store.ui.tool)) patch.tool = 'select';
  store.setUi(patch);
}

const snapSelect = $<HTMLSelectElement>('#snap');
snapSelect.value = String(store.ui.snap);
snapSelect.addEventListener('change', () => store.setUi({ snap: parseFloat(snapSelect.value) }));

$('#undo').addEventListener('click', () => store.undo());
$('#redo').addEventListener('click', () => store.redo());
$('#fit').addEventListener('click', () => (store.ui.view === '2d' ? editor.zoomToFit() : view3d.frame(false)));

// ---------- plans: saved as files in the project's plans/ folder ----------

const autosave = new ProjectAutosave(store);
const planLabel = $('#plan-name');
let apiAvailable = false;

function syncPlanLabel() {
  if (!apiAvailable) {
    planLabel.hidden = true;
    return;
  }
  const name = store.planName;
  const state = autosave.state;
  planLabel.hidden = false;
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

/** True if it's fine to replace the current plan. Named plans are already saved to disk. */
function okToDiscard(what: string) {
  if (store.planName || !store.plan.walls.length) return true;
  return confirm(`${what}? The current plan hasn't been saved and will be lost.`);
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
  a.download = `${store.planName ?? 'house-plan'}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function saveAs() {
  if (!apiAvailable) return download();
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
  store.replacePlan(emptyPlan(), null);
  store.setUi({ tool: 'wall' });
});
$('#example').addEventListener('click', () => {
  if (!okToDiscard('Load the example house')) return;
  openPlan(examplePlan(), null);
});
$('#save-as').addEventListener('click', saveAs);

const openDialog = $<HTMLDialogElement>('#open-dialog');
const planList = $('#plan-list');
$('#open').addEventListener('click', async () => {
  planList.innerHTML = '';
  if (!apiAvailable) {
    planList.innerHTML = '<li class="empty">Saving to the project needs the dev server (<code>npm run dev</code>).</li>';
  } else {
    const plans = await listPlans().catch(() => []);
    if (!plans.length) planList.innerHTML = '<li class="empty">No saved plans yet. Use "Save as…" to add one.</li>';
    for (const p of plans) {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.innerHTML = '<b></b><span></span>';
      b.querySelector('b')!.textContent = p.name;
      b.querySelector('span')!.textContent = new Date(p.updated).toLocaleString();
      if (p.name === store.planName) b.classList.add('active');
      b.addEventListener('click', async () => {
        if (!okToDiscard(`Open "${p.name}"`)) return;
        const plan = await loadPlan(p.name).catch(() => null);
        if (!plan) return alert(`Could not open "${p.name}".`);
        openDialog.close();
        openPlan(plan, p.name);
      });
      li.append(b);
      planList.append(li);
    }
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
    openPlan(plan, null);
  } catch {
    alert('That file could not be read as a house plan.');
  }
});

// On startup, the plan file in the project is the source of truth (it may have changed,
// e.g. after a git pull); fall back to the browser copy if it's missing.
plansApiAvailable().then(async (ok) => {
  apiAvailable = ok;
  const name = store.planName;
  if (ok && name) {
    const plan = await loadPlan(name).catch(() => null);
    if (plan) openPlan(plan, name);
    else await autosave.saveNow();
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

const shortcuts: Record<string, Tool> = { v: 'select', w: 'wall', d: 'door', n: 'window', b: 'furniture' };

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
    if (store.planName && apiAvailable) autosave.saveNow();
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
