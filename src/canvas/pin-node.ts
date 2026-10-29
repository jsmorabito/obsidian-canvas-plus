import type { CanvasPlusPlugin } from '../main.ts';
import { CanvasLike, CanvasNodeLike, batch, getExtra, nodeBox, patchData, pressNode } from './adapter.ts';
import { isAnchor } from './anchor.ts';
import { CLICK_SLOP_PX, FIELD_KIND, FIELD_PIN, KIND_TEXT, SIZE_NOTE_CARD, SIZE_PIN } from './constants.ts';
import { LINEAR_ICON, TASKAPP_ICON } from './icons.ts';
import { readDiagram } from './diagram-data.ts';
import { readIssueRef } from './issue-ref.ts';
import { createPinBubble } from './pin-bubble.ts';
import { readInk } from './ink-nodes.ts';
import { pinCard } from './note-card.ts';
import { typeLinkColor } from './note-card-content.ts';
import { readWidget } from './widget-card.ts';
import { listWidgets } from './widgets.ts';

const PIN_CLASS = 'ffc-node-pin';
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
  patchData(node, { [FIELD_PIN]: undefined });
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
      else if (!isPinned(node)) pinCard(node);
    }
  });
}

/** The icon and colour a pin wears: the note type's, for a typed note, else one for what the node holds. */
export function pinLook(plugin: CanvasPlusPlugin, node: CanvasNodeLike, data = node.getData?.()): { icon: string; color: string } {
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
 * until the pin is hovered, when it opens beside the pin at the size it had. `open` runs when the pin is clicked. Idempotent, so safe to run on a timer.
 */
export function decoratePins(plugin: CanvasPlusPlugin, canvas: CanvasLike, open: (node: CanvasNodeLike) => void): void {
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
    const { icon, color } = pinLook(plugin, node, data);
    const key = `${icon}|${color}|${size.width}|${size.height}`;
    el.setAttribute('data-ffc-pin', '');
    if (drawn.get(node) === key && el.querySelector(`.${PIN_CLASS}`)) continue;
    drawn.set(node, key);
    el.setCssProps({ '--ffc-pin-width': `${size.width}px`, '--ffc-pin-height': `${size.height}px`, '--ffc-pin-color': color });
    el.querySelector(`.${PIN_CLASS}`)?.remove();
    openOnClick(canvas, node, createPinBubble(el, icon, PIN_CLASS), open);
  }
}

/**
 * A click on the pin opens the node; a drag moves it. The bubble keeps its size on screen while the node's box scales with
 * the canvas, so at most zooms it reaches past the box where core looks for presses: the press is handed to core from here.
 */
function openOnClick(canvas: CanvasLike, node: CanvasNodeLike, bubble: HTMLElement, open: (node: CanvasNodeLike) => void): void {
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
  el.setCssProps({ '--ffc-pin-width': '', '--ffc-pin-height': '', '--ffc-pin-color': '' });
  drawn.delete(node);
}

export function clearPins(canvas: CanvasLike): void {
  for (const node of canvas.nodes?.values() ?? []) clearPin(node);
}
