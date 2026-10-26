import { App, WorkspaceLeaf } from 'obsidian';
import { CanvasLike, CanvasNodeLike, batch, createTextNode, getExtra, patchData, viewportCenter } from './adapter.ts';
import { FIELD_WIDGET, SIZE_WIDGET } from './constants.ts';
import { findFreeSpot } from './free-spot.ts';
import { createHostedLeaf, HostedLeaf } from './hosted-leaf.ts';

const CLASS = 'ffc-widget';
const MISSING_CLASS = 'ffc-widget-missing';

interface Shown {
  type: string;
  box: HTMLElement;
  /** Null while the view type isn't registered (its plugin is off): the box says so instead. */
  hosted: HostedLeaf | null;
}

/** The view running in each widget node, kept so it isn't rebuilt every sweep. */
const shown = new WeakMap<CanvasNodeLike, Shown>();
/** Each canvas's nodes holding a view, so they can be torn down when they leave that canvas. */
const live = new WeakMap<CanvasLike, Set<CanvasNodeLike>>();
/** Nodes whose view closed itself: left empty rather than reopened. */
const gone = new WeakSet<CanvasNodeLike>();
/** Nodes whose text editing was turned off here: what they hold is the view, not text to edit. */
const locked = new WeakSet<CanvasNodeLike>();

/** The view type a node holds, or null. */
export function readWidget(node: CanvasNodeLike, data?: Record<string, unknown>): string | null {
  const v = getExtra(node, FIELD_WIDGET, data) as { type?: unknown } | undefined;
  return v && typeof v === 'object' && typeof v.type === 'string' && v.type ? v.type : null;
}

function isRegistered(app: App, type: string): boolean {
  const registry = (app as unknown as { viewRegistry?: { viewByType?: Record<string, unknown> } }).viewRegistry;
  return !!registry?.viewByType?.[type];
}

/** Add a node showing the `type` view, near the middle of the view. */
export function addWidgetNode(canvas: CanvasLike, type: string): void {
  const pos = findFreeSpot(canvas, viewportCenter(canvas), SIZE_WIDGET);
  const node = batch(canvas, () => {
    const created = createTextNode(canvas, { pos, size: SIZE_WIDGET, text: '', focus: false });
    if (created) patchData(created, { [FIELD_WIDGET]: { type } });
    return created;
  });
  if (node) {
    canvas.deselectAll?.();
    canvas.selectOnly?.(node);
  }
}

/**
 * Dress a text node that holds a widget: the view itself, running in the node. Idempotent, so safe to run on a timer.
 * Presses and keys reach the view only while the node is selected, so an unselected node can still be dragged.
 */
export function decorateWidget(app: App, canvas: CanvasLike, host: WorkspaceLeaf, node: CanvasNodeLike, data?: Record<string, unknown>): void {
  const el = node.nodeEl;
  if (!el) return;
  const type = readWidget(node, data);
  const container = el.querySelector<HTMLElement>('.canvas-node-container');
  if (!type || !container) {
    clearWidget(canvas, node);
    return;
  }
  el.setAttribute('data-ffc-widget', type);
  if (!locked.has(node)) {
    locked.add(node);
    node.startEditing = () => { /* a widget isn't edited as text */ };
  }
  const registered = isRegistered(app, type);
  const current = shown.get(node);
  if (current?.type === type && (current.hosted !== null) === registered) {
    // Obsidian rebuilds a node's content now and then: put the box back rather than rebuilding the view.
    if (current.box.parentElement !== container) container.appendChild(current.box);
    return;
  }
  if (current) destroyShown(canvas, node, current);
  if (gone.has(node)) return;

  const box = container.createDiv({ cls: CLASS });
  let hosted: HostedLeaf | null = null;
  if (registered) {
    hosted = createHostedLeaf(app, host, () => {
      gone.add(node);
      const entry = shown.get(node);
      if (entry) destroyShown(canvas, node, entry);
    });
    box.appendChild(hosted.el);
    const selected = (): boolean => el.hasClass('is-selected') || el.hasClass('is-focused');
    for (const press of ['pointerdown', 'wheel'] as const) {
      box.addEventListener(press, (e) => { if (selected()) e.stopPropagation(); });
    }
    // Keys the canvas would act on (Delete, arrows, tool letters) belong to the view, but app hotkeys and Esc pass.
    box.addEventListener('keydown', (e) => {
      if (selected() && e.key !== 'Escape' && !e.ctrlKey && !e.metaKey) e.stopPropagation();
    });
    void hosted.leaf.setViewState({ type });
  } else {
    box.createDiv({ cls: MISSING_CLASS, text: 'This widget isn’t available. Enable the plugin that provides it.' });
  }
  shown.set(node, { type, box, hosted });
  let nodes = live.get(canvas);
  if (!nodes) live.set(canvas, nodes = new Set());
  nodes.add(node);
}

/** Tear down the views of nodes that have left the canvas. */
export function pruneWidgets(canvas: CanvasLike): void {
  const nodes = live.get(canvas);
  if (!nodes) return;
  const present = new Set(canvas.nodes?.values() ?? []);
  for (const node of Array.from(nodes)) if (!present.has(node)) clearWidget(canvas, node);
}

function destroyShown(canvas: CanvasLike, node: CanvasNodeLike, entry: Shown): void {
  shown.delete(node);
  live.get(canvas)?.delete(node);
  entry.hosted?.destroy();
  entry.box.remove();
}

function clearWidget(canvas: CanvasLike, node: CanvasNodeLike): void {
  if (locked.delete(node)) Reflect.deleteProperty(node, 'startEditing');
  gone.delete(node);
  const current = shown.get(node);
  if (current) destroyShown(canvas, node, current);
  node.nodeEl?.removeAttribute('data-ffc-widget');
}

export function clearWidgets(canvas: CanvasLike): void {
  for (const node of Array.from(live.get(canvas) ?? [])) clearWidget(canvas, node);
}
