/**
 * The only module that touches Obsidian's undocumented canvas internals.
 * Canvas has no public view API, so everything else in src/canvas talks to the
 * canvas through the typed helpers here. If an Obsidian update breaks the
 * canvas integration, this is the file to patch.
 */
import type { App, ItemView, TFile } from 'obsidian';

export interface CanvasNodeLike {
  id?: string;
  nodeEl?: HTMLElement;
  text?: string;
  /** Core's colour preset ('1' to '6') or a CSS colour; unset for none. */
  color?: string;
  /** Set on file nodes. */
  file?: TFile;
  /** A file node's embedded note view, loaded on demand. `dirty` means it holds edits not yet saved. */
  child?: { dirty?: boolean };
  unloadChild?: () => void;
  filePath?: string;
  setFile?: (file: TFile, subpath?: string, force?: boolean) => void;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  startEditing?: () => void;
  /** Core's press on a node: select it and drag. Bound to the node's box, and to a group's label. */
  onPointerdown?: (e: PointerEvent) => void;
  moveAndResize?: (rect: { x: number; y: number; width: number; height: number }) => void;
  getData?: () => Record<string, unknown>;
  setData?: (data: Record<string, unknown>) => void;
  /** Obsidian round-trips unrecognised node fields through this bag. */
  unknownData?: Record<string, unknown>;
}

export interface EdgeEnd {
  node: CanvasNodeLike;
  side: string;
  end: string;
}

export interface CanvasEdgeLike {
  id: string;
  label?: string;
  from: EdgeEnd;
  to: EdgeEnd;
  lineGroupEl?: Element;
  lineEndGroupEl?: Element;
  labelElement?: { wrapperEl?: HTMLElement; focus?: (...args: unknown[]) => void };
  editLabel?: () => void;
  getData: () => Record<string, unknown>;
}

export interface CanvasLike {
  wrapperEl: HTMLElement;
  /** Core's resize handles and connection points for the selected node: one element on the canvas, moved to whichever node is its target. */
  nodeInteractionLayer?: { interactionEl: HTMLElement; target?: CanvasNodeLike | null; setTarget?: (node: CanvasNodeLike | null) => void };
  nodes?: Map<string, CanvasNodeLike>;
  /** The layer of the node last brought to the front: core gives a node a higher one each time it is selected. */
  zIndexCounter?: number;
  posFromEvt?: (evt: { clientX: number; clientY: number }) => { x: number; y: number };
  createTextNode?: (opts: {
    pos: { x: number; y: number };
    size?: { width: number; height: number };
    text?: string;
    save?: boolean;
    focus?: boolean;
  }) => CanvasNodeLike | undefined;
  createGroupNode?: (opts: {
    pos: { x: number; y: number };
    size: { width: number; height: number };
    label?: string;
    save?: boolean;
    focus?: boolean;
  }) => CanvasNodeLike | undefined;
  createFileNode?: (opts: {
    pos: { x: number; y: number };
    size?: { width: number; height: number };
    file: TFile;
    save?: boolean;
    focus?: boolean;
  }) => CanvasNodeLike | undefined;
  removeNode?: (node: CanvasNodeLike) => void;
  selectOnly?: (node: CanvasNodeLike) => void;
  toggleSelect?: (node: CanvasNodeLike) => void;
  /** Sets where the view is heading; core's frame loop then eases the view there (about 300ms). */
  zoomToBbox?: (bbox: { minX: number; minY: number; maxX: number; maxY: number }) => void;
  /** When set, core's next frame lands the view on its target at once instead of easing (as a canvas does when it opens). */
  finishViewportAnimation?: boolean;
  /** The zoom the view is heading to (log2 of its scale); core eases the on-screen zoom towards it. */
  tZoom?: number;
  /** Centre the view on a canvas point, at once, keeping the zoom. */
  panTo?: (x: number, y: number) => void;
  /** Core asks for its next frame through this whenever the view pans or zooms, or a node moves or changes. */
  requestFrame?: (...args: unknown[]) => void;
  /** The animation frame core has asked for and not yet run, or 0. */
  frame?: number;
  getViewportBBox?: () => { minX: number; minY: number; maxX: number; maxY: number };
  /** `false` saves without recording an undo step. */
  requestSave?: (pushHistory?: boolean) => void;
  /** Obsidian's debounced (250ms) history push; `.run()` flushes it now. */
  requestPushHistory?: { run?: () => void; cancel?: () => void };
  pushHistory?: (data: unknown) => void;
  history?: { data: unknown[]; current: number; canUndo?: () => boolean; canRedo?: () => boolean };
  undo?: () => void;
  redo?: () => void;
  getData?: () => unknown;
  deselectAll?: () => void;
  selection?: Set<object>;
  edges?: Map<string, CanvasEdgeLike>;
  removeEdge?: (edge: CanvasEdgeLike) => void;
  markDirty?: (node: CanvasNodeLike) => void;
  /** Obsidian's own bottom menu (Card, Note, Media buttons). */
  cardMenuEl?: HTMLElement;
  /** Obsidian's control groups down the right side (settings, zoom, undo, help). */
  canvasControlsEl?: HTMLElement;
  /**
   * Obsidian's drag from a menu button: shows an outline of `size` that follows the pointer (with
   * snapping) and calls `onDrop` with the top-left of where it landed, if that is on the canvas.
   */
  dragTempNode?: (e: PointerEvent, size: { width: number; height: number }, onDrop: (pos: { x: number; y: number }) => void) => void;
  importData?: (data: { nodes: unknown[]; edges: unknown[] }, replace?: boolean) => unknown;
  /** Core's read-only mode, the lock in the canvas controls: nothing can be moved, edited, added or deleted. */
  readonly?: boolean;
  /** Core saves the mode only when the lock itself is selected, so setting it here lasts until the view closes. */
  setReadonly?: (readonly: boolean) => void;
  /** Core's edge scrolling while something is dragged near the canvas's edge calls this every frame. */
  panBy?: (x: number, y: number) => void;
  /**
   * The canvas file as loaded, or the history entry undo last applied. `getData` spreads it under the nodes and
   * edges, so a field of ours here is saved with the file and undone with the canvas. History entries share
   * it: replace it, never change it in place.
   */
  data?: Record<string, unknown>;
  /** The selection pop-up menu. Obsidian empties and rebuilds `menuEl` on every selection change. */
  menu?: { menuEl?: HTMLElement; containerEl?: HTMLElement; render?: (rebuild?: boolean) => void };
}

export interface CanvasViewLike extends ItemView {
  canvas?: CanvasLike;
  /** The canvas file shown. A view can go on to show another one, as a note's view does. */
  file?: TFile | null;
  /** What core keeps for this file on this device only: `readonly` when its lock is on. */
  getLocalData?: () => unknown;
}

/** Returns the view as a canvas view whose canvas has finished mounting, else null. */
export function asCanvasView(view: unknown): CanvasViewLike | null {
  const v = view as Partial<CanvasViewLike> | null | undefined;
  if (!v || typeof v.getViewType !== 'function' || v.getViewType() !== 'canvas') return null;
  return v.canvas?.wrapperEl ? (v as CanvasViewLike) : null;
}

/** Client (screen) coordinates → canvas coordinates. */
export function toCanvasPoint(
  canvas: CanvasLike,
  evt: { clientX: number; clientY: number },
): { x: number; y: number } | null {
  return canvas.posFromEvt ? canvas.posFromEvt(evt) : null;
}

/** `data` is the node's `getData()`, when the caller has already read it. */
export function getExtra(node: CanvasNodeLike, key: string, data = node.getData?.()): unknown {
  return data?.[key] ?? node.unknownData?.[key];
}

/** Merge fields into a node's data. Fields Obsidian doesn't know about are kept in `unknownData` by `setData`. */
export function patchData(node: CanvasNodeLike, patch: Record<string, unknown>): void {
  if (node.getData && node.setData) node.setData({ ...node.getData(), ...patch });
}

export function setExtra(node: CanvasNodeLike, key: string, value: unknown): void {
  if (node.unknownData) node.unknownData[key] = value;
  if (node.getData && node.setData) {
    const data = node.getData();
    data[key] = value;
    node.setData(data);
  }
}

/**
 * Run `fn` as one undo step. An empty canvas has no baseline history entry
 * (Obsidian calls createPlaceholder instead of pushHistory), so the first
 * edit would otherwise be un-undoable; push the pre-edit state first. After
 * `fn`, flush the debounced history push so rapid gestures don't merge.
 */
export function batch<T>(canvas: CanvasLike, fn: () => T): T {
  if (canvas.history?.data.length === 0) canvas.pushHistory?.(canvas.getData?.());
  const result = fn();
  canvas.requestSave?.();
  canvas.requestPushHistory?.run?.();
  return result;
}

export function createTextNode(
  canvas: CanvasLike,
  opts: { pos: { x: number; y: number }; size: { width: number; height: number }; text?: string; focus?: boolean },
): CanvasNodeLike | undefined {
  if (!canvas.createTextNode) throw new Error('Canvas internals changed: createTextNode is unavailable');
  return canvas.createTextNode({ ...opts, text: opts.text ?? '', save: true });
}

export function createGroupNode(
  canvas: CanvasLike,
  opts: { pos: { x: number; y: number }; size: { width: number; height: number }; label?: string; focus?: boolean },
): CanvasNodeLike | undefined {
  if (!canvas.createGroupNode) throw new Error('Canvas internals changed: createGroupNode is unavailable');
  return canvas.createGroupNode({ ...opts, label: opts.label ?? '', save: true });
}

export function removeNode(canvas: CanvasLike, node: CanvasNodeLike): void {
  canvas.removeNode?.(node);
}

export function createFileNode(
  canvas: CanvasLike,
  opts: { pos: { x: number; y: number }; size: { width: number; height: number }; file: TFile },
): CanvasNodeLike | undefined {
  if (!canvas.createFileNode) throw new Error('Canvas internals changed: createFileNode is unavailable');
  return canvas.createFileNode({ ...opts, save: true, focus: false });
}

export interface Box { x: number; y: number; width: number; height: number }

export function nodeBox(node: CanvasNodeLike): Box | null {
  const { x, y, width, height } = node;
  return x === undefined || y === undefined || width === undefined || height === undefined
    ? null
    : { x, y, width, height };
}

/** Screen pixels of the canvas's left and bottom edges that floating panels cover. */
export interface Insets { left: number; bottom: number }

const insetSources = new WeakMap<CanvasLike, () => Insets>();

/** Say what the floating panels on a canvas cover, for `focusNode`; null when they're gone. */
export function setInsets(canvas: CanvasLike, source: (() => Insets) | null): void {
  if (source) insetSources.set(canvas, source);
  else insetSources.delete(canvas);
}

/** Select `node` and zoom the view onto it with `zoomToBox`. */
export function focusNode(canvas: CanvasLike, node: CanvasNodeLike): void {
  const box = nodeBox(node);
  canvas.deselectAll?.();
  canvas.selectOnly?.(node);
  if (box) zoomToBox(canvas, box);
}

/**
 * Zoom the view onto `box`, clear of the floating panels set with `setInsets`: the box is padded on the
 * left and bottom, by amounts worked out from the zoom Obsidian will pick (it fits a box with 10% margin,
 * max zoom 1).
 */
export function zoomToBox(canvas: CanvasLike, box: Box): void {
  const insets = insetSources.get(canvas)?.() ?? { left: 0, bottom: 0 };
  const rect = canvas.wrapperEl.getBoundingClientRect();
  const fitZoom = (w: number, h: number): number => Math.min(1, rect.width / (1.1 * w), rect.height / (1.1 * h));
  let padX = 0;
  let padY = 0;
  if ((insets.left > 0 || insets.bottom > 0) && rect.width > 0 && rect.height > 0) {
    for (let i = 0; i < 3; i++) {
      const zoom = fitZoom(box.width + padX, box.height + padY);
      padX = insets.left / zoom;
      padY = insets.bottom / zoom;
    }
  }
  canvas.zoomToBbox?.({ minX: box.x - padX, minY: box.y, maxX: box.x + box.width, maxY: box.y + box.height + padY });
}

/**
 * Press `node` from an element of ours outside its box, as core does from a group's label: select it and drag
 * it (or neither on a read-only canvas). Without core's handler, just select it.
 */
export function pressNode(canvas: CanvasLike, node: CanvasNodeLike, e: PointerEvent): void {
  if (node.onPointerdown) node.onPointerdown(e);
  else if (e.button === 0) {
    if (e.shiftKey) canvas.toggleSelect?.(node);
    else canvas.selectOnly?.(node);
  }
}

/** Whether the view's file has core's lock saved on, which core applies whenever it loads the file. */
export function savedReadonly(view: CanvasViewLike): boolean | undefined {
  const data = view.getLocalData?.();
  if (!data || typeof data !== 'object' || !('readonly' in data)) return undefined;
  return data.readonly === true;
}

export function isReadonly(canvas: CanvasLike): boolean {
  return !!canvas.readonly;
}

/** Switch core's read-only mode, as its lock does, without saving it as the canvas's own setting. */
export function setReadonly(canvas: CanvasLike, readonly: boolean): void {
  canvas.setReadonly?.(readonly);
}

/**
 * Centre the view on a canvas point, keeping the zoom, with core's own easing. `panTo` would jump; this asks
 * `zoomToBbox` for a box the size of the view, less the 10% margin it adds. The size comes from the zoom the
 * view is heading to, not the one on screen, so a move made while another is still easing keeps the zoom
 * that one was going to. It doesn't zoom in past 100%, so a view zoomed in further also zooms out to 100%.
 */
export function glideTo(canvas: CanvasLike, x: number, y: number): void {
  const rect = canvas.wrapperEl.getBoundingClientRect();
  const scale = canvas.tZoom === undefined ? NaN : 2 ** canvas.tZoom;
  if (!Number.isFinite(scale) || scale <= 0 || rect.width === 0 || rect.height === 0 || !canvas.zoomToBbox) {
    canvas.panTo?.(x, y);
    return;
  }
  const halfW = rect.width / scale / 2.2;
  const halfH = rect.height / scale / 2.2;
  canvas.zoomToBbox({ minX: x - halfW, minY: y - halfH, maxX: x + halfW, maxY: y + halfH });
}

/** Land the view's current move at once instead of easing there, as core does when a canvas opens. */
export function finishViewportMove(canvas: CanvasLike): void {
  canvas.finishViewportAnimation = true;
}

/** Centre of what the user is looking at, in canvas coordinates. */
export function viewportCenter(canvas: CanvasLike): { x: number; y: number } {
  const bb = canvas.getViewportBBox?.();
  return bb ? { x: (bb.minX + bb.maxX) / 2, y: (bb.minY + bb.maxY) / 2 } : { x: 0, y: 0 };
}

export function isEdge(o: object): o is CanvasEdgeLike {
  return 'from' in o && 'to' in o && 'getData' in o;
}

export function selectedNodes(canvas: CanvasLike): CanvasNodeLike[] {
  return [...(canvas.selection ?? [])].filter((o): o is CanvasNodeLike => !isEdge(o));
}

/**
 * While a connection is being dragged, the edge's far end is a temporary
 * pseudo-node that isn't part of the canvas. True once both ends are real.
 */
export function isConnected(canvas: CanvasLike, edge: CanvasEdgeLike): boolean {
  const real = (n: CanvasNodeLike): boolean => n.id !== undefined && canvas.nodes?.get(n.id) === n;
  return real(edge.from.node) && real(edge.to.node);
}

/**
 * Edge data with a new label. When `reversed`, the end nodes swap and the
 * arrow follows, so the edge always points the way the relation really runs.
 */
export function relabeled(data: Record<string, unknown>, label: string | undefined, reversed = false): Record<string, unknown> {
  const out: Record<string, unknown> = { ...data, label };
  if (!label) delete out.label;
  if (reversed) {
    out.fromNode = data.toNode; out.fromSide = data.toSide;
    out.toNode = data.fromNode; out.toSide = data.fromSide;
    out.toEnd = 'arrow';
    delete out.fromEnd;
  }
  return out;
}

/** A field of ours on the canvas file itself, beside its nodes and edges. */
export function getCanvasExtra(canvas: CanvasLike, key: string): unknown {
  return canvas.data?.[key];
}

/** Set (or, with undefined, remove) a field on the canvas file. Saved and recorded for undo by the caller, as with nodes. */
export function setCanvasExtra(canvas: CanvasLike, key: string, value: unknown): void {
  const data: Record<string, unknown> = { ...canvas.data };
  if (value === undefined) delete data[key];
  else data[key] = value;
  canvas.data = data;
}

/** Add (or replace, by id) nodes and edges from JSON Canvas data, without saving. */
export function importNodes(canvas: CanvasLike, nodes: Record<string, unknown>[], edges: Record<string, unknown>[]): void {
  if (!canvas.importData) throw new Error('Canvas internals changed: importData is unavailable');
  canvas.importData({ nodes, edges }, false);
}

/** The nodes core is moving in a drag of the selection (a group drags what it contains too), or none. */
export function draggedNodes(canvas: CanvasLike): CanvasNodeLike[] {
  // Most pointer moves aren't node drags: ask the DOM first rather than visit every node.
  if (!canvas.wrapperEl.querySelector('.canvas-node.is-dragging')) return [];
  return [...(canvas.nodes?.values() ?? [])].filter((n) => n.nodeEl?.hasClass('is-dragging'));
}

/**
 * Stop core's edge scrolling until the returned function is called. A drag held over something of ours just
 * outside the canvas would otherwise scroll the canvas the whole time.
 */
export function holdEdgePan(canvas: CanvasLike): () => void {
  const original = canvas.panBy;
  if (!original) return () => { /* nothing to restore */ };
  const own = Object.prototype.hasOwnProperty.call(canvas, 'panBy');
  const held = (): void => { /* held */ };
  canvas.panBy = held;
  return () => {
    if (canvas.panBy !== held) return;
    if (own) canvas.panBy = original;
    else Reflect.deleteProperty(canvas, 'panBy');
  };
}

/** Remove an edge without saving; the caller saves or restores it. */
export function dropEdge(canvas: CanvasLike, edge: CanvasEdgeLike): void {
  canvas.removeEdge?.(edge);
}

/** Add (or replace, by id) an edge from JSON Canvas data. */
export function putEdge(canvas: CanvasLike, data: Record<string, unknown>): void {
  if (!canvas.importData) throw new Error('Canvas internals changed: importData is unavailable');
  canvas.importData({ nodes: [], edges: [data] }, false);
}

/** A fresh id, in the form Obsidian uses for nodes and edges (16 hex characters). */
export function newId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Call `cb` whenever the selection changes. Obsidian rebuilds the selection
 * pop-up menu on every change, so a child-list observer on it is the signal.
 * Returns a function that stops watching.
 */
export function watchSelection(canvas: CanvasLike, cb: () => void): () => void {
  const menuEl = canvas.menu?.menuEl;
  if (!menuEl) return () => { /* nothing to stop */ };
  const observer = new MutationObserver(cb);
  observer.observe(menuEl, { childList: true });
  return () => observer.disconnect();
}

/**
 * Call `after` each time Obsidian positions the selection pop-up menu: on every selection change (`rebuilt`
 * true, as core rebuilds the buttons then), and as the canvas pans and zooms. Returns a function that puts
 * the original back.
 */
export function afterMenuRender(canvas: CanvasLike, after: (containerEl: HTMLElement, rebuilt: boolean) => void): () => void {
  const menu = canvas.menu;
  const original = menu?.render;
  if (!menu || !original) return () => { /* nothing to restore */ };
  let active = true;
  const patched = function (this: unknown, rebuild?: boolean): void {
    original.call(this, rebuild);
    if (active && menu.containerEl?.isConnected) after(menu.containerEl, !!rebuild);
  };
  menu.render = patched;
  return () => {
    // Another plugin may have wrapped render since: then ours stays in its chain, but does nothing more.
    active = false;
    if (menu.render === patched) menu.render = original;
  };
}

/**
 * Call `after` once core has drawn a frame: when the view pans or zooms, or anything on the canvas moves or
 * changes. Each frame core asks for gets one of ours, asked for just after it in the same window, so `after`
 * runs once that frame is drawn. A request made while core's frame is already pending shares it. Returns a
 * function that puts the original back.
 */
export function afterCanvasFrame(canvas: CanvasLike, after: () => void): () => void {
  const original = canvas.requestFrame;
  if (!original) return () => { /* nothing to restore */ };
  const own = Object.prototype.hasOwnProperty.call(canvas, 'requestFrame');
  let active = true;
  /** The core frame ours follows. Core asks for its next frame from inside the current one, while ours for the current one is still pending. */
  let paired: number | null = null;
  const patched = function (this: unknown, ...args: unknown[]): void {
    original.apply(this, args);
    // Without core's frame handle, one of ours per request still catches every change.
    const frame = canvas.frame ?? NaN;
    if (!active || frame === 0 || frame === paired) return;
    paired = frame;
    canvas.wrapperEl.win.requestAnimationFrame(() => {
      if (paired === frame) paired = null;
      if (active) after();
    });
  };
  canvas.requestFrame = patched;
  return () => {
    // As with afterMenuRender: if another plugin has wrapped it since, ours stays in the chain but does nothing.
    active = false;
    if (canvas.requestFrame !== patched) return;
    if (own) canvas.requestFrame = original;
    else Reflect.deleteProperty(canvas, 'requestFrame');
  };
}

/**
 * Reload the embedded note of file nodes showing one of `paths`. An embed keeps its own copy of the
 * text, so after the plugin edits a note it can keep showing the old version. This is what Obsidian does
 * when a node's file changes (drop the child, let the next render reload it); an embed with unsaved
 * typing is skipped.
 */
export function reloadEmbeds(canvas: CanvasLike, paths: ReadonlySet<string>): void {
  for (const node of canvas.nodes?.values() ?? []) {
    if (!node.file || !paths.has(node.file.path) || node.child?.dirty) continue;
    node.unloadChild?.();
    canvas.markDirty?.(node);
  }
}

/** The path of the file a canvas shows, found through the view that owns it. */
export function canvasFilePath(app: App, canvas: CanvasLike): string | undefined {
  let path: string | undefined;
  app.workspace.iterateAllLeaves((leaf) => {
    const view = asCanvasView(leaf.view);
    if (view?.canvas === canvas) path = (view as { file?: TFile | null }).file?.path;
  });
  return path;
}

/**
 * Point file nodes whose note was missing at `file`. A file node looks its note up
 * only when its path is set, so a node restored by redo while the note was gone keeps
 * showing a missing-file placeholder after the note is recreated, unless it is re-bound.
 */
export function rebindFileNodes(canvas: CanvasLike, file: TFile): void {
  for (const node of canvas.nodes?.values() ?? []) {
    if (node.filePath === file.path && !node.file) node.setFile?.(file, '', true);
  }
}

/*
 * `instanceof Element` (or Node, HTMLElement) is false for an element that lives in another window, such as
 * a canvas popped out of the main window, because each window has its own copy of those classes. Check
 * what the object can do instead.
 */
export function isElement(target: EventTarget | null | undefined): target is Element {
  return !!target && typeof (target as Element).closest === 'function';
}

export function isNode(target: EventTarget | null | undefined): target is Node {
  return !!target && typeof (target as Node).nodeType === 'number';
}

/** Keep presses and scrolling on a floating panel from reaching the canvas underneath. */
export function shieldFromCanvas(el: HTMLElement): void {
  for (const type of ['pointerdown', 'wheel'] as const) el.addEventListener(type, (e) => e.stopPropagation());
}

/**
 * Make `el` editable as one line of plain text, and return a function that ends it. Core only treats
 * `contentEditable === 'true'` as typing (not `plaintext-only`), so anything else lets the canvas take the
 * arrow keys to nudge the selection. With `true`, a paste would bring formatting, so it is pasted as text.
 */
export function editPlainText(el: HTMLElement): () => void {
  const onPaste = (e: ClipboardEvent): void => {
    e.preventDefault();
    const text = (e.clipboardData?.getData('text/plain') ?? '').replace(/\s+/g, ' ');
    const range = el.win.getSelection()?.getRangeAt(0);
    if (!range) return;
    range.deleteContents();
    range.insertNode(el.doc.createTextNode(text));
    range.collapse(false);
  };
  el.contentEditable = 'true';
  el.addEventListener('paste', onPaste);
  return () => {
    el.removeEventListener('paste', onPaste);
    el.contentEditable = 'false';
  };
}
