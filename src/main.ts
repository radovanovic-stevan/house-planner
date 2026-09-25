import './style.css';
import { Editor2D } from './editor2d';
import { examplePlan } from './example';
import { emptyPlan, normalizePlan } from './model';
import { deleteSelection } from './ops';
import { Panel } from './panel';
import { Store, type Tool, type ViewMode } from './store';

const store = new Store();
const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

const editor = new Editor2D($<HTMLCanvasElement>('#plan'), store);
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
$('#fit').addEventListener('click', () => editor.zoomToFit());

$('#new').addEventListener('click', () => {
  if (store.plan.walls.length && !confirm('Start a new, empty plan? (You can undo this.)')) return;
  store.replacePlan(emptyPlan());
  store.setUi({ tool: 'wall' });
});
$('#example').addEventListener('click', () => {
  if (store.plan.walls.length && !confirm('Replace the current plan with the example house? (You can undo this.)')) return;
  store.replacePlan(examplePlan());
  editor.zoomToFit();
});
$('#export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(store.plan, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'house-plan.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
const fileInput = $<HTMLInputElement>('#file');
$('#import').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  fileInput.value = '';
  if (!file) return;
  try {
    store.replacePlan(normalizePlan(JSON.parse(await file.text())));
    editor.zoomToFit();
  } catch {
    alert('That file could not be read as a house plan.');
  }
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
  if (key === 'f' && store.ui.view === '2d') editor.zoomToFit();
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
