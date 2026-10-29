import type { CanvasPlusPlugin } from '../main.ts';
import { CanvasLike, CanvasNodeLike, batch, getExtra, nodeBox, patchData, pressNode } from './adapter.ts';
import { isAnchor } from './anchor.ts';
import { CLICK_SLOP_PX, FIELD_KIND, FIELD_PIN, FIELD_PIN_AT, KIND_TEXT, PRESET_VARS, SIZE_NOTE_CARD, SIZE_PIN } from './constants.ts';
import { LINEAR_ICON, TASKAPP_ICON } from './icons.ts';
import { readDiagram } from './diagram-data.ts';
import { readIssueRef } from './issue-ref.ts';
import { createPinBubble } from './pin-bubble.ts';
import { readInk } from './ink-nodes.ts';
import { pinCard } from './note-card.ts';
import { Attach, readAttach, setAttachments, trackPinDrop } from './pin-attach.ts';
import { typeLinkColor } from './note-card-content.ts';
import { readWidget } from './widget-card.ts';
import { listWidgets } from './widgets.ts';

const PIN_CLASS = 'ffc-node-pin';
/** Holds copies of what a pinned group held, in the group's preview. */
const CONTENTS_CLASS = 'ffc-pin-contents';
/** Custom properties core and this plugin set on a node for its colour and styling, which its content is drawn with. */
const KEPT_PROP = /^--(?!ffc-pin-color)/;
/** What a copy of a node leaves out: the pin, core's handles and label. */
const LEFT_OUT = '.ffc-node-pin, .canvas-node-connection-point, .canvas-node-resizer, .canvas-node-label';
/** On a pin that was just pressed: its hover preview stays hidden until the pointer leaves. */
const QUIET_CLASS = 'ffc-pin-quiet';
const FALLBACK_ICON = 'file';
const HTML_EXTENSIONS = new Set(['html', 'htm']);
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'avif', 'bmp']);

/** What a pin was last drawn from, so an unchanged one isn't redrawn every sweep. */
const drawn = new WeakMap<CanvasNodeLike, string>();

/** The icon of each widget view, once found: finding it scans every view type. */
const widgetIcons = new Map<string, string>();

/** The size a pinned node goes back to, or null when it isn't pinned. */
export function pinnedSize(node: CanvasNodeLike): { width: number; height: number } | null {
  return readSize(node);
}

function readSize(node: CanvasNodeLike, data?: Record<string, unknown>): { width: number; height: number } | null {
  const v = getExtra(node, FIELD_PIN, data) as { width?: unknown; height?: unknown } | undefined;
  return v && typeof v.width === 'number' && typeof v.height === 'number' && v.width > 0 && v.height > 0
    ? { width: v.width, height: v.height }
    : null;
}

/** The ids of what a pinned group held when it was pinned, which are hidden along with it. */
function readMembers(node: CanvasNodeLike, data?: Record<string, unknown>): string[] {
  const v = getExtra(node, FIELD_PIN, data) as { members?: unknown } | undefined;
  return Array.isArray(v?.members) ? v.members.filter((id): id is string => typeof id === 'string') : [];
}

/** What a group holds: every other node whole inside its box (a nested group and what is in it too). */
function groupMembers(canvas: CanvasLike, group: CanvasNodeLike): string[] {
  if (group.getData?.().type !== 'group') return [];
  const outer = nodeBox(group);
  if (!outer) return [];
  const ids: string[] = [];
  for (const node of canvas.nodes?.values() ?? []) {
    const box = nodeBox(node);
    if (!node.id || node === group || !box) continue;
    if (box.x >= outer.x && box.y >= outer.y && box.x + box.width <= outer.x + outer.width && box.y + box.height <= outer.y + outer.height) ids.push(node.id);
  }
  return ids;
}

/**
 * A copy of a node as it is drawn, for a preview to hold. It keeps the node's classes and colour, which its content's styles
 * are written against, and loses its place on the canvas, its pin and its selection.
 */
export function snapshotOf(source: HTMLElement): HTMLElement {
  const copy = source.cloneNode(true) as HTMLElement;
  copy.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));
  copy.removeAttribute('data-ffc-pin');
  copy.removeAttribute('data-ffc-pin-hidden');
  copy.removeClasses(['is-selected', 'is-focused']);
  copy.querySelectorAll(LEFT_OUT).forEach((el) => el.remove());
  const props: Array<[string, string]> = [];
  for (const name of Array.from(source.style)) if (KEPT_PROP.test(name)) props.push([name, source.style.getPropertyValue(name)]);
  copy.removeAttribute('style');
  for (const [name, value] of props) copy.style.setProperty(name, value);
  return copy;
}

/** Whether the node is shown as a pin. */
export function isPinned(node: CanvasNodeLike): boolean {
  return !!getExtra(node, FIELD_PIN);
}

/** Whether a node can be shown as a pin: anything but a pen stroke, or an anchor, which is already a marker. */
export function canPin(node: CanvasNodeLike): boolean {
  return !!node.nodeEl && !readInk(node) && !isAnchor(node);
}

/** Shrink a node to a pin, remembering `size` to give back. The pin sits where the node's top-left corner was. Not an undo step by itself. */
export function pinNode(node: CanvasNodeLike, size: { width: number; height: number }): void {
  const box = nodeBox(node);
  patchData(node, { [FIELD_PIN]: { width: size.width, height: size.height } });
  if (box) node.moveAndResize?.({ ...box, width: SIZE_PIN, height: SIZE_PIN });
}

/** Give a pinned node back the size it had. Not an undo step by itself. */
export function unpinNode(node: CanvasNodeLike): void {
  const size = readSize(node);
  const box = nodeBox(node);
  // No longer a pin, so no longer attached to anything.
  patchData(node, { [FIELD_PIN]: undefined, [FIELD_PIN_AT]: undefined });
  if (box) node.moveAndResize?.({ ...box, ...(size ?? SIZE_NOTE_CARD) });
}

/**
 * Pin the nodes, or put them back as they were when they are all pinned already, as one undo step. A pinned node shrinks to the
 * pin and remembers its size, so unpinning gives it back.
 */
export function togglePins(canvas: CanvasLike, nodes: CanvasNodeLike[]): void {
  if (nodes.length === 0) return;
  const unpin = nodes.every(isPinned);
  batch(canvas, () => {
    for (const node of nodes) {
      if (unpin) unpinNode(node);
      else if (!isPinned(node)) {
        // A group takes what is in it along: asked before it shrinks, while its box still holds them.
        const members = groupMembers(canvas, node);
        pinCard(node);
        const size = readSize(node);
        if (members.length > 0 && size) patchData(node, { [FIELD_PIN]: { ...size, members } });
      }
    }
  });
}

/**
 * The icon and colour a pin wears. The icon is the note type's for a typed note, else one for what the node holds. The colour is
 * the one the node was given on the canvas, else the note type's link colour, else none.
 */
export function pinLook(plugin: CanvasPlusPlugin, node: CanvasNodeLike, data = node.getData?.()): { icon: string; color: string } {
  const look = iconFor(plugin, node, data);
  const given = data?.color;
  const color = typeof given === 'string' && given ? PRESET_VARS[given] ?? given : look.color;
  return color === look.color ? look : { ...look, color };
}

function iconFor(plugin: CanvasPlusPlugin, node: CanvasNodeLike, data: Record<string, unknown> | undefined): { icon: string; color: string } {
  const ref = readIssueRef(node, data);
  if (ref) return { icon: ref.provider === 'linear' ? LINEAR_ICON : TASKAPP_ICON, color: '' };
  // The same icon as the Add diagram tool.
  if (readDiagram(node, data)) return { icon: 'workflow', color: '' };
  // The icons of the tools that make them, and of the view a widget holds.
  const widget = readWidget(node, data);
  if (widget) {
    let icon = widgetIcons.get(widget);
    if (!icon) {
      icon = listWidgets(plugin.app).find((w) => w.type === widget)?.icon;
      if (icon) widgetIcons.set(widget, icon);
    }
    return { icon: icon ?? 'puzzle', color: '' };
  }
  if (getExtra(node, FIELD_KIND, data) === KIND_TEXT) return { icon: 'type', color: '' };
  const file = node.file;
  if (file) {
    const type = file.extension === 'md' ? plugin.types.getNoteTypeForFile(file) : undefined;
    if (type) return { icon: type.linkIcon?.trim() || 'file-text', color: typeLinkColor(type) ?? '' };
    if (file.extension === 'md') return { icon: 'file-text', color: '' };
    if (HTML_EXTENSIONS.has(file.extension)) return { icon: 'file-code', color: '' };
    return { icon: IMAGE_EXTENSIONS.has(file.extension) ? 'image' : FALLBACK_ICON, color: '' };
  }
  const type = data?.type;
  if (type === 'link') return { icon: 'link', color: '' };
  if (type === 'group') return { icon: 'frame', color: '' };
  return { icon: 'sticky-note', color: '' };
}

/**
 * Dress pinned nodes: a bubble with their icon, where the node was. The node's own content stays in the node, hidden
 * until the pin is hovered, when it opens beside the pin at the size it had. `open` runs when the pin is clicked, and `onAttach` after a drag attached it to a node, or let it go. Idempotent, so safe to run on a timer.
 */
export function decoratePins(plugin: CanvasPlusPlugin, canvas: CanvasLike, open: (node: CanvasNodeLike) => void, onAttach: () => void): void {
  const hidden = new Set<string>();
  const attached = new Map<string, Attach>();
  for (const node of canvas.nodes?.values() ?? []) {
    const el = node.nodeEl;
    if (!el) continue;
    // Read once: every check below would otherwise copy the node's data again.
    const data = node.getData?.();
    const size = readSize(node, data);
    if (!size) {
      clearPin(node);
      continue;
    }
    const attach = readAttach(node, data);
    if (attach && node.id) attached.set(node.id, attach);
    const members = readMembers(node, data);
    for (const id of members) hidden.add(id);
    if (members.length > 0) syncContents(canvas, node, members);
    const { icon, color } = pinLook(plugin, node, data);
    const key = `${icon}|${color}|${size.width}|${size.height}`;
    el.setAttribute('data-ffc-pin', '');
    if (drawn.get(node) === key && el.querySelector(`.${PIN_CLASS}`)) continue;
    drawn.set(node, key);
    el.setCssProps({ '--ffc-pin-width': `${size.width}px`, '--ffc-pin-height': `${size.height}px`, '--ffc-pin-color': color });
    el.querySelector(`.${PIN_CLASS}`)?.remove();
    const bubble = createPinBubble(el, icon, PIN_CLASS);
    // A pin with a colour is tinted like the card it came from.
    bubble.toggleClass('has-color', !!color);
    openOnClick(canvas, node, bubble, open, onAttach);
  }
  // A pin attached to something that is hidden is hidden with it, as are pins attached to those.
  for (let grew = true; grew;) {
    grew = false;
    for (const [id, at] of attached) {
      if (!hidden.has(at.node) || hidden.has(id)) continue;
      hidden.add(id);
      grew = true;
    }
  }
  setAttachments(canvas, attached);
  hideMembers(canvas, hidden);
}

/** What each pinned group's preview was last drawn from, so an unchanged one isn't copied again every sweep. */
const shownContents = new WeakMap<CanvasNodeLike, string>();

/**
 * Put copies of what a pinned group held in its preview, where they were in the group. The nodes themselves stay hidden, so
 * the preview is the only place they show. A view or a page isn't copied, as it would load a second time.
 */
function syncContents(canvas: CanvasLike, group: CanvasNodeLike, members: string[]): void {
  const container = group.nodeEl?.querySelector<HTMLElement>(':scope > .canvas-node-container');
  const origin = nodeBox(group);
  if (!container || !origin) return;
  const parts: Array<{ node: CanvasNodeLike; el: HTMLElement; dx: number; dy: number; width: number; height: number }> = [];
  for (const id of members) {
    const node = canvas.nodes?.get(id);
    const box = node && nodeBox(node);
    const el = node?.nodeEl;
    if (!node || !box || !el || readWidget(node) || el.querySelector('iframe, webview')) continue;
    parts.push({ node, el, dx: box.x - origin.x, dy: box.y - origin.y, width: box.width, height: box.height });
  }
  const signature = parts.map((p) => `${p.node.id}:${p.dx},${p.dy},${p.width},${p.height}:${p.el.textContent?.length ?? 0}`).join('|');
  const holder = container.querySelector<HTMLElement>(`:scope > .${CONTENTS_CLASS}`);
  if (holder && shownContents.get(group) === signature) return;
  shownContents.set(group, signature);
  const contents = holder ?? container.createDiv({ cls: CONTENTS_CLASS });
  contents.empty();
  for (const p of parts) {
    const copy = snapshotOf(p.el);
    copy.setCssProps({ '--ffc-dx': `${p.dx}px`, '--ffc-dy': `${p.dy}px`, '--ffc-w': `${p.width}px`, '--ffc-h': `${p.height}px` });
    contents.appendChild(copy);
  }
}

/** The canvases that have something hidden by a pinned group, so a sweep with nothing to hide needn't walk everything. */
const hiding = new WeakSet<CanvasLike>();

/** Hide what pinned groups held, and the edges that touch them; show everything else. */
function hideMembers(canvas: CanvasLike, hidden: Set<string>): void {
  if (hidden.size === 0 && !hiding.has(canvas)) return;
  for (const node of canvas.nodes?.values() ?? []) node.nodeEl?.toggleAttribute('data-ffc-pin-hidden', !!node.id && hidden.has(node.id));
  for (const edge of canvas.edges?.values() ?? []) {
    const gone = !!edge.from.node.id && hidden.has(edge.from.node.id) || !!edge.to.node.id && hidden.has(edge.to.node.id);
    edge.lineGroupEl?.classList.toggle('ffc-pin-hidden', gone);
    edge.lineEndGroupEl?.classList.toggle('ffc-pin-hidden', gone);
    edge.labelElement?.wrapperEl?.classList.toggle('ffc-pin-hidden', gone);
  }
  if (hidden.size > 0) hiding.add(canvas);
  else hiding.delete(canvas);
}

/**
 * A click on the pin opens the node; a drag moves it. The bubble keeps its size on screen while the node's box scales with
 * the canvas, so at most zooms it reaches past the box where core looks for presses: the press is handed to core from here.
 */
function openOnClick(canvas: CanvasLike, node: CanvasNodeLike, bubble: HTMLElement, open: (node: CanvasNodeLike) => void, onAttach: () => void): void {
  let down: { x: number; y: number } | null = null;
  bubble.addEventListener('pointerdown', (e) => {
    down = { x: e.clientX, y: e.clientY };
    // The preview is for hovering: once the pin is pressed it stays away until the pointer has left the pin.
    const el = node.nodeEl;
    if (el) {
      el.addClass(QUIET_CLASS);
      el.addEventListener('pointerleave', () => el.removeClass(QUIET_CLASS), { once: true });
    }
    // Not also taken as a press on the canvas behind it (core would pan, or press the node a second time).
    e.stopPropagation();
    pressNode(canvas, node, e);
    // A drag that ends over a node attaches the pin to it.
    trackPinDrop(canvas, node, e, bubble.doc, onAttach);
  });
  bubble.addEventListener('click', (e) => {
    const from = down;
    down = null;
    if (from && Math.hypot(e.clientX - from.x, e.clientY - from.y) < CLICK_SLOP_PX) open(node);
  });
}

function clearPin(node: CanvasNodeLike): void {
  const el = node.nodeEl;
  if (!el || !el.hasAttribute('data-ffc-pin')) return;
  el.removeAttribute('data-ffc-pin');
  el.querySelector(`.${PIN_CLASS}`)?.remove();
  el.querySelector(`.${CONTENTS_CLASS}`)?.remove();
  el.setCssProps({ '--ffc-pin-width': '', '--ffc-pin-height': '', '--ffc-pin-color': '' });
  drawn.delete(node);
  shownContents.delete(node);
}

export function clearPins(canvas: CanvasLike): void {
  for (const node of canvas.nodes?.values() ?? []) clearPin(node);
  hideMembers(canvas, new Set());
}
