import { CanvasLike, CanvasNodeLike, afterMenuRender, batch, getExtra, patchData, selectedNodes } from './adapter.ts';
import { FIELD_KIND, KIND_ANCHOR } from './constants.ts';

/** The label a new anchor starts with, selected so typing replaces it. */
export const DEFAULT_ANCHOR_LABEL = 'Anchor';

const LABEL_CLASS = 'ffc-anchor-label';
/** Screen pixels kept between the selection menu and an anchor's label. */
const MENU_GAP_PX = 6;
/** Core keeps the menu at least this far inside the canvas. */
const MENU_EDGE_PX = 10;

/** The `startEditing` overrides `syncAnchor` installed, so `clearAnchor` only removes its own. */
const renames = new WeakSet<() => void>();

export const isAnchor = (node: CanvasNodeLike): boolean => getExtra(node, FIELD_KIND) === KIND_ANCHOR;

/** The anchor's name: its text, on one line. */
export function anchorLabel(node: CanvasNodeLike): string {
  return (node.text ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * An anchor is a text node holding just its label. The node itself only shows the icon; the label sits above it in
 * core's own node label (the one file nodes have), so it stays the same size on screen at every zoom.
 * Editing renames it in that label, as a group's label is renamed, instead of opening the markdown editor.
 */
export function syncAnchor(canvas: CanvasLike, node: CanvasNodeLike): void {
  const el = node.nodeEl;
  if (!el) return;
  if (!Object.prototype.hasOwnProperty.call(node, 'startEditing')) {
    const rename = (): void => editAnchorLabel(canvas, node);
    renames.add(rename);
    node.startEditing = rename;
  }
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
  // While renaming, a press places the caret instead of dragging the node or panning the canvas.
  label.addEventListener('pointerdown', (e) => { if (label.isContentEditable) e.stopPropagation(); });
  return label;
}

/** Remove what `syncAnchor` added, for a node that is no longer an anchor or on plugin unload. */
export function clearAnchor(node: CanvasNodeLike): void {
  node.nodeEl?.querySelector(`:scope > .${LABEL_CLASS}`)?.remove();
  const own = Object.prototype.hasOwnProperty.call(node, 'startEditing') ? node.startEditing : undefined;
  if (own && renames.has(own)) Reflect.deleteProperty(node, 'startEditing');
}

/** Rename the anchor in place: Enter or leaving the label saves, Escape cancels. Left empty, it keeps its old name. */
export function editAnchorLabel(canvas: CanvasLike, node: CanvasNodeLike): void {
  const el = node.nodeEl;
  if (!el) return;
  const label = labelEl(canvas, node, el);
  if (label.isContentEditable) return;
  const before = anchorLabel(node);
  label.textContent = before;
  // Plain text only: a paste brings no formatting, and pasted lines stay apart (they're joined with spaces below).
  label.contentEditable = 'plaintext-only';
  label.addClass('is-editing');
  label.focus();
  label.win.getSelection()?.selectAllChildren(label);

  let done = false;
  const finish = (save: boolean): void => {
    if (done) return;
    done = true;
    label.removeEventListener('keydown', onKey);
    label.removeEventListener('blur', onBlur);
    label.contentEditable = 'false';
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
  label.addEventListener('keydown', onKey);
  label.addEventListener('blur', onBlur);
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
      anchors = selectedNodes(canvas).filter(isAnchor);
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
