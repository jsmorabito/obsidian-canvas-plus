import { Menu, Notice, setIcon } from 'obsidian';
import type { CanvasPlusPlugin } from '../main.ts';
import { CanvasLike, CanvasNodeLike, batch, focusNode, getExtra, isElement, selectedNodes, setExtra, toCanvasPoint, zoomToBox } from './adapter.ts';
import { FIELD_NAV } from './constants.ts';
import { isInk } from './ink-nodes.ts';
import { button } from './issue-menu.ts';
import { describe } from './layers-tree.ts';
import { toolButton } from './toolbar-parts.ts';

type Way = 'next' | 'prev';

/** Where one object's signpost buttons go: where it leads, as a node's id (`id#part` for a node inside a diagram card). */
export interface Nav {
  next?: string;
  prev?: string;
}

/** What has signposts: a canvas object, or a node inside a diagram card (by the id it is drawn with). */
export interface NavSource {
  node: CanvasNodeLike;
  part?: string;
}

/** A place a signpost leads to, found on the canvas. */
interface Place {
  node: CanvasNodeLike;
  part?: string;
  el: Element;
}

const SIGNPOST_CLASS = 'ffc-signpost-btn';
const WAY_CLASS: Record<Way, string> = { next: 'ffc-signpost-next-btn', prev: 'ffc-signpost-prev-btn' };
const WAY: Record<Way, { icon: string; word: string }> = {
  next: { icon: 'step-forward', word: 'next' },
  prev: { icon: 'step-back', word: 'previous' },
};
const PICKING_CLASS = 'ffc-signpost-picking';
const HOVER_CLASS = 'ffc-signpost-hover';
const MENU_AREAS = '.canvas-menu-container, .canvas-card-menu, .canvas-controls, .ffc-mm-toolbar, .ffc-mm-tools';

const refOf = (source: NavSource): string => (source.part ? `${source.node.id}#${source.part}` : source.node.id ?? '');

function readNavField(node: CanvasNodeLike, data?: Record<string, unknown>): { own: Nav; parts: Record<string, Nav> } {
  const v = getExtra(node, FIELD_NAV, data) as (Nav & { parts?: Record<string, Nav> }) | undefined;
  const clean = (n: Nav | undefined): Nav => {
    const out: Nav = {};
    if (n && typeof n === 'object') {
      if (typeof n.next === 'string') out.next = n.next;
      if (typeof n.prev === 'string') out.prev = n.prev;
    }
    return out;
  };
  const parts: Record<string, Nav> = {};
  if (v && typeof v === 'object' && v.parts && typeof v.parts === 'object') {
    for (const [part, nav] of Object.entries(v.parts)) parts[part] = clean(nav);
  }
  return { own: clean(v), parts };
}

/** A malformed field (hand-edited) counts as no signposts. */
export function readNav(source: NavSource): Nav {
  const { own, parts } = readNavField(source.node);
  return source.part ? parts[source.part] ?? {} : own;
}

/** Where a reference points on the canvas, if it is still there. */
function find(canvas: CanvasLike, ref: string | undefined): Place | undefined {
  if (!ref) return undefined;
  const [id, part] = ref.split('#');
  const node = canvas.nodes?.get(id);
  if (!node?.nodeEl) return undefined;
  if (!part) return { node, el: node.nodeEl };
  const el = Array.from(node.nodeEl.querySelectorAll('.pele-node')).find((e) => e.getAttribute('data-id') === part);
  return el ? { node, part, el } : undefined;
}

const targetOf = (canvas: CanvasLike, source: NavSource, way: Way): Place | undefined => find(canvas, readNav(source)[way]);

function labelOf(plugin: CanvasPlusPlugin, place: Place): string {
  return place.part ? place.el.textContent?.replace(/\s+/g, ' ').trim() || 'Node' : describe(plugin, place.node).label;
}

function setNav(canvas: CanvasLike, source: NavSource, way: Way, to: string | undefined): void {
  const field = readNavField(source.node);
  const nav = { ...(source.part ? field.parts[source.part] ?? {} : field.own), [way]: to };
  if (!to) delete nav[way];
  if (!source.part) field.own = nav;
  else if (nav.next || nav.prev) field.parts[source.part] = nav;
  else delete field.parts[source.part];
  const hasParts = Object.keys(field.parts).length > 0;
  const value = field.own.next || field.own.prev || hasParts ? { ...field.own, ...(hasParts ? { parts: field.parts } : {}) } : undefined;
  batch(canvas, () => setExtra(source.node, FIELD_NAV, value));
}

/** Go to a place: select its object and zoom the view onto it (onto the node itself, for one inside a diagram card). */
function goTo(canvas: CanvasLike, place: Place): void {
  if (!place.part) {
    focusNode(canvas, place.node);
    return;
  }
  canvas.deselectAll?.();
  canvas.selectOnly?.(place.node);
  const rect = place.el.getBoundingClientRect();
  const from = toCanvasPoint(canvas, { clientX: rect.left, clientY: rect.top });
  const to = toCanvasPoint(canvas, { clientX: rect.right, clientY: rect.bottom });
  if (from && to) zoomToBox(canvas, { x: from.x, y: from.y, width: to.x - from.x, height: to.y - from.y });
}

/**
 * Wait for a click on an object of the canvas, or on a node inside a diagram card, and pass what it is to `done`. A
 * press on empty canvas still pans, so the view can be moved to find it; Escape gives up.
 */
function pickPlace(canvas: CanvasLike, source: NavSource, prompt: string, done: (ref: string) => void): void {
  const wrapper = canvas.wrapperEl;
  const win = wrapper.win;
  const notice = new Notice(prompt, 0);
  wrapper.addClass(PICKING_CLASS);
  const nodeAt = (target: EventTarget | null): { ref: string; el: Element } | undefined => {
    if (!isElement(target) || !wrapper.contains(target) || target.closest(MENU_AREAS)) return undefined;
    const cardEl = target.closest('.canvas-node');
    const node = cardEl ? [...(canvas.nodes?.values() ?? [])].find((n) => n.nodeEl === cardEl) : undefined;
    if (!node?.id) return undefined;
    const partEl = target.closest('.pele-node[data-id]');
    const part = partEl && cardEl?.contains(partEl) ? partEl.getAttribute('data-id') : null;
    return part && partEl ? { ref: `${node.id}#${part}`, el: partEl } : { ref: node.id, el: cardEl ?? node.nodeEl ?? target };
  };
  let hovered: Element | null = null;
  // Outline what a click would pick, as the selected object is outlined: the cursor alone doesn't say.
  const hover = (e: PointerEvent): void => {
    const over = nodeAt(e.target);
    const el = over && over.ref !== refOf(source) ? over.el : null;
    if (el === hovered) return;
    hovered?.classList.remove(HOVER_CLASS);
    hovered = el;
    hovered?.classList.add(HOVER_CLASS);
  };
  const stop = (): void => {
    hovered?.classList.remove(HOVER_CLASS);
    win.removeEventListener('pointermove', hover, true);
    win.removeEventListener('pointerdown', press, true);
    win.removeEventListener('keydown', key, true);
    wrapper.removeClass(PICKING_CLASS);
    notice.hide();
  };
  const press = (e: PointerEvent): void => {
    const hit = nodeAt(e.target);
    if (!hit) return;
    // Past core and the diagram editors, which would select and drag it, and past the click that follows.
    e.preventDefault();
    e.stopPropagation();
    win.addEventListener('click', (c) => c.stopPropagation(), { capture: true, once: true });
    stop();
    if (hit.ref === refOf(source)) new Notice('Pick a different object.');
    else done(hit.ref);
  };
  const key = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    stop();
  };
  // On the window, so these run before the listeners the diagram editors keep on the canvas.
  win.addEventListener('pointermove', hover, true);
  win.addEventListener('pointerdown', press, true);
  win.addEventListener('keydown', key, true);
}

/** What the signpost button offers: set each way, or change and remove one that is set. */
export function openSignpostMenu(plugin: CanvasPlusPlugin, canvas: CanvasLike, source: NavSource, e: MouseEvent, changed: () => void): void {
  const menu = new Menu();
  const apply = (way: Way, to: string | undefined): void => {
    setNav(canvas, source, way, to);
    canvas.menu?.render?.(true);
    changed();
  };
  for (const way of ['next', 'prev'] as const) {
    const { icon, word } = WAY[way];
    const to = targetOf(canvas, source, way);
    const named = to ? `: ${labelOf(plugin, to)}` : '';
    menu.addItem((item) => item.setSection(way).setTitle(to ? `Change ${word} object${named}` : `Add ${word} object…`).setIcon(icon).onClick(() => {
      pickPlace(canvas, source, `Select the ${word} object to go to. Press Esc to cancel.`, (ref) => apply(way, ref));
    }));
    if (readNav(source)[way]) menu.addItem((item) => item.setSection(way).setTitle(`Remove ${word} object`).setIcon('x').onClick(() => apply(way, undefined)));
  }
  menu.showAtMouseEvent(e);
}

/** The buttons for `source`'s signposts, as `show` is asked to draw them: a step back, the signpost, a step forward. */
function buttonsFor(
  plugin: CanvasPlusPlugin, canvas: CanvasLike, source: NavSource, changed: () => void,
  show: (cls: string, label: string, icon: string, run: (e: MouseEvent) => void) => void,
): void {
  const go = (way: Way) => (): void => {
    const to = targetOf(canvas, source, way);
    if (to) goTo(canvas, to);
    else new Notice('That object is no longer on the canvas.');
  };
  const prev = targetOf(canvas, source, 'prev');
  const next = targetOf(canvas, source, 'next');
  if (prev) show(WAY_CLASS.prev, `Go to previous: ${labelOf(plugin, prev)}`, WAY.prev.icon, go('prev'));
  if (!canvas.readonly) show(SIGNPOST_CLASS, 'Add next or previous object', 'signpost', (e) => openSignpostMenu(plugin, canvas, source, e, changed));
  if (next) show(WAY_CLASS.next, `Go to next: ${labelOf(plugin, next)}`, WAY.next.icon, go('next'));
}

/**
 * Signpost buttons in a diagram's node toolbar: for the node picked, a step back and a step forward where it leads,
 * and the signpost to set them. `changed` redraws the toolbar once they are.
 */
export function addSignpostButtons(bar: HTMLElement, plugin: CanvasPlusPlugin, canvas: CanvasLike, source: NavSource, changed: () => void): void {
  buttonsFor(plugin, canvas, source, changed, (_cls, label, icon, run) => {
    const btn = toolButton(bar, label);
    setIcon(btn, icon);
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      run(e);
    });
  });
}

/**
 * Buttons in the selection pop-up menu for one selected object. Obsidian rebuilds the menu on every selection
 * change, so this runs after each one.
 */
export function injectSignpostButtons(plugin: CanvasPlusPlugin, canvas: CanvasLike, selected: CanvasNodeLike[]): void {
  const menuEl = canvas.menu?.menuEl;
  if (!menuEl) return;
  const node = selected.length === 1 && !isInk(selected[0]) ? selected[0] : undefined;
  const wanted = new Set<string>();
  if (node) {
    buttonsFor(plugin, canvas, { node }, () => undefined, (cls, label, icon) => {
      wanted.add(cls);
      button(menuEl, cls, label, icon, () => undefined);
      // The button keeps the handler it was made with, so it works out what to do for the selection of the moment.
      const btn = menuEl.querySelector<HTMLElement>(`.${cls}`);
      if (btn) btn.onclick = (e) => {
        const now = selectedNodes(canvas)[0];
        if (now) buttonsFor(plugin, canvas, { node: now }, () => undefined, (c, _label, _icon, run) => { if (c === cls) run(e); });
      };
    });
  }
  for (const cls of [WAY_CLASS.prev, SIGNPOST_CLASS, WAY_CLASS.next]) {
    if (!wanted.has(cls)) menuEl.querySelector(`:scope > .${cls}`)?.remove();
  }
}
