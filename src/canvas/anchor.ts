import {
  CanvasLike, CanvasNodeLike, afterMenuRender, batch, editPlainText, getExtra, isNode, isReadonly, patchData, pressNode,
  selectedNodes,
} from './adapter.ts';
import { FIELD_FRAME, FIELD_KIND, KIND_ANCHOR } from './constants.ts';

/** A new anchor is named this with a number (Anchor 1, Anchor 2…), selected so typing replaces it. */
const DEFAULT_ANCHOR_LABEL = 'Anchor';
const DEFAULT_LABEL_PATTERN = new RegExp(`^${DEFAULT_ANCHOR_LABEL} (\\d+)$`);

const LABEL_CLASS = 'ffc-anchor-label';
/** Screen pixels kept between the selection menu and an anchor's label. */
const MENU_GAP_PX = 6;
/** Core keeps the menu at least this far inside the canvas. */
const MENU_EDGE_PX = 10;

/** The `startEditing` overrides `syncAnchor` installed, so `clearAnchor` only removes its own. */
const renames = new WeakSet<() => void>();
/** Renames in progress, by anchor, so `clearAnchor` can end one whose canvas is closing or whose plugin unloads. */
const editing = new WeakMap<CanvasNodeLike, () => void>();

/** `data` is the node's `getData()`, when the caller has already read it. */
export const isAnchor = (node: CanvasNodeLike, data?: Record<string, unknown>): boolean =>
  getExtra(node, FIELD_KIND, data) === KIND_ANCHOR;

/** An anchor drawn as a frame: its box is what a presentation shows at that stop. */
export const isAnchorFrame = (node: CanvasNodeLike, data?: Record<string, unknown>): boolean =>
  isAnchor(node, data) && getExtra(node, FIELD_FRAME, data) === true;

/** The name for a new anchor: one past the highest "Anchor N" on the canvas, so names stay apart even if never changed. */
export function nextAnchorLabel(canvas: CanvasLike): string {
  let highest = 0;
  for (const node of canvas.nodes?.values() ?? []) {
    const n = isAnchor(node) ? Number(DEFAULT_LABEL_PATTERN.exec(anchorLabel(node))?.[1] ?? 0) : 0;
    highest = Math.max(highest, n);
  }
  return `${DEFAULT_ANCHOR_LABEL} ${highest + 1}`;
}

/** The anchor's name: its text, on one line. */
export function anchorLabel(node: CanvasNodeLike): string {
  return (node.text ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * An anchor is a text node holding just its label. The node itself only shows the icon; the label sits above it in
 * core's own node label (the one file nodes have), so it stays the same size on screen at every zoom.
 * Editing renames it in that label, as a group's label is renamed, instead of opening the markdown editor.
 */
export function syncAnchor(canvas: CanvasLike, node: CanvasNodeLike, data?: Record<string, unknown>): void {
  const el = node.nodeEl;
  if (!el) return;
  if (!Object.prototype.hasOwnProperty.call(node, 'startEditing')) {
    const rename = (): void => editAnchorLabel(canvas, node);
    renames.add(rename);
    node.startEditing = rename;
  }
  el.toggleAttribute('data-ffc-frame', isAnchorFrame(node, data));
  const label = labelEl(canvas, node, el);
  if (label.isContentEditable) return;
  const text = anchorLabel(node);
  if (label.textContent !== text) label.textContent = text;
}

function labelEl(canvas: CanvasLike, node: CanvasNodeLike, el: HTMLElement): HTMLElement {
  const existing = el.querySelector<HTMLElement>(`:scope > .${LABEL_CLASS}`);
  if (existing) return existing;
  const label = el.createDiv({ cls: `canvas-node-label ${LABEL_CLASS}` });
  // Core only edits a node double-clicked inside its box, and the label sits above it.
  label.addEventListener('dblclick', (e) => {
    e.preventDefault();
    e.stopPropagation();
    editAnchorLabel(canvas, node);
  });
  // The name picks the anchor up and drags it, as a group's label does (a frame lets presses through until it
  // is selected). While renaming, a press places the caret instead of dragging the node or panning the canvas.
  label.addEventListener('pointerdown', (e) => {
    if (label.isContentEditable) e.stopPropagation();
    else pressNode(canvas, node, e);
  });
  return label;
}

/** Remove what `syncAnchor` added, for a node that is no longer an anchor or on plugin unload. */
export function clearAnchor(node: CanvasNodeLike): void {
  // Cancelled, not saved: the canvas may already be going away.
  editing.get(node)?.();
  node.nodeEl?.querySelector(`:scope > .${LABEL_CLASS}`)?.remove();
  node.nodeEl?.removeAttribute('data-ffc-frame');
  const own = Object.prototype.hasOwnProperty.call(node, 'startEditing') ? node.startEditing : undefined;
  if (own && renames.has(own)) Reflect.deleteProperty(node, 'startEditing');
}

/**
 * Rename the anchor in place: Enter or leaving the label saves, Escape cancels. Left empty, it keeps its old name.
 * A read-only canvas (core's lock, or a presentation) keeps its names.
 */
export function editAnchorLabel(canvas: CanvasLike, node: CanvasNodeLike): void {
  const el = node.nodeEl;
  if (!el || isReadonly(canvas)) return;
  const label = labelEl(canvas, node, el);
  if (label.isContentEditable) return;
  const before = anchorLabel(node);
  label.textContent = before;
  const stopEditing = editPlainText(label);
  label.addClass('is-editing');
  label.focus();
  label.win.getSelection()?.selectAllChildren(label);

  let done = false;
  const finish = (save: boolean): void => {
    if (done) return;
    done = true;
    editing.delete(node);
    label.removeEventListener('keydown', onKey);
    label.removeEventListener('blur', onBlur);
    label.doc.removeEventListener('pointerdown', onPressAway, true);
    stopEditing();
    label.removeClass('is-editing');
    label.win.getSelection()?.removeAllRanges();
    const after = (label.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (save && after && after !== before) batch(canvas, () => patchData(node, { text: after }));
    label.textContent = anchorLabel(node);
  };
  const onKey = (e: KeyboardEvent): void => {
    // Keep keys away from the canvas (Delete would remove the node) and the tool shortcuts.
    e.stopPropagation();
    if (e.isComposing) return;
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  };
  // Switching to another window blurs the label too; focus comes back to it on return, so keep editing.
  const onBlur = (): void => { if (label.doc.hasFocus()) finish(true); };
  // A press anywhere else ends it too, even if the label never got focus (and so will never blur).
  const onPressAway = (e: PointerEvent): void => { if (!isNode(e.target) || !label.contains(e.target)) finish(true); };
  label.addEventListener('keydown', onKey);
  label.addEventListener('blur', onBlur);
  label.doc.addEventListener('pointerdown', onPressAway, true);
  editing.set(node, () => finish(false));
}

/**
 * Core places the selection menu just above the selected nodes, allowing for the labels of file nodes and
 * groups but not ours, so it would sit on an anchor's name. Once core has placed it, move it clear: above the
 * labels it covers, or below their anchors if there is no room above.
 */
export function keepMenuClearOfLabels(canvas: CanvasLike): () => void {
  // The selected anchors, found again only when the selection changes, not on every pan and zoom frame.
  let anchors: CanvasNodeLike[] = [];
  let anchorsFor = -1;
  return afterMenuRender(canvas, (containerEl, rebuilt) => {
    const size = canvas.selection?.size ?? 0;
    if (size === 0) return;
    if (rebuilt || size !== anchorsFor) {
      anchors = selectedNodes(canvas).filter((n) => isAnchor(n));
      anchorsFor = size;
    }
    if (anchors.length === 0) return;
    const top = parseFloat(containerEl.style.top);
    const menuEl = canvas.menu?.menuEl;
    if (!menuEl || Number.isNaN(top)) return;
    const menu = menuEl.getBoundingClientRect();
    // Only labels the menu actually sits over, side to side and top to bottom.
    const covered = anchors.flatMap((node) => {
      const label = node.nodeEl?.querySelector<HTMLElement>(`:scope > .${LABEL_CLASS}`);
      if (!label || label.offsetParent === null) return [];
      const rect = label.getBoundingClientRect();
      const hit = rect.left < menu.right && rect.right > menu.left && rect.top - MENU_GAP_PX < menu.bottom && rect.bottom > menu.top;
      return hit ? [{ label: rect, node: node.nodeEl!.getBoundingClientRect() }] : [];
    });
    if (covered.length === 0) return;
    const lift = menu.bottom - (Math.min(...covered.map((c) => c.label.top)) - MENU_GAP_PX);
    const drop = Math.max(...covered.map((c) => c.node.bottom)) + MENU_GAP_PX - menu.top;
    const next = top - lift >= MENU_EDGE_PX ? top - lift : top + drop;
    containerEl.setCssStyles({ top: `${next}px` });
  });
}
