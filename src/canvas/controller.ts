import type { CanvasPlusPlugin } from '../main.ts';
import { Component, Notice } from 'obsidian';
import {
  CanvasLike, CanvasNodeLike, CanvasViewLike, getExtra, isElement, patchData, selectedNodes, setInsets, toCanvasPoint, watchSelection,
} from './adapter.ts';
import { ContextPanel } from './context-panel.ts';
import { attachUndoJournal } from './undo-journal.ts';
import { LayersPanel } from './layers-panel.ts';
import { Minimap } from './minimap.ts';
import { CanvasPanels } from './canvas-panels.ts';
import { PanelStore } from './panel-store.ts';
import { CLICK_SLOP_PX, FIELD_KIND, INK_FALLBACK_HEX, SIZE_NOTE_CARD } from './constants.ts';
import { clearNoteCards, decorateNoteCards, fitNodeToCard, noteOfNode, setCardOwner, toggleViews } from './note-card.ts';
import { injectViewToggleButton } from './view-toggle.ts';
import { NotePicker } from './note-picker.ts';
import { RelationFlow } from './relation-flow.ts';
import { imageFromDrop, injectKeyImageButton, setKeyImage } from './key-image.ts';
import { InkTools } from './ink-tools.ts';
import { inkSvg, colorToHex } from './ink-render.ts';
import { readInk } from './ink-nodes.ts';
import { fitAllFreeText, fitFreeText, freeTextAt } from './free-text-fit.ts';
import { PlacedRect, placeNode, placementRect } from './placement.ts';
import { clearAnchor, isAnchor, keepMenuClearOfLabels, syncAnchor } from './anchor.ts';
import { CardMenu } from './card-menu.ts';
import { Presenter } from './presentation.ts';
import { Focuser } from './focus.ts';
import { Tray } from './tray.ts';
import { registerToolShortcuts } from './shortcuts.ts';
import { trackPointer } from './pointer-session.ts';
import { eachFrameUntil } from '../utils/helpers.ts';
import { ActionId, isInkTool, isPlacementTool, PlaceTool, ToolId } from './tools.ts';

/** Obsidian's own controls and menus live inside the canvas wrapper; a tool must never treat clicks on them as drawing. */
const NATIVE_CANVAS_UI = '.canvas-controls, .canvas-card-menu, .canvas-menu-container';

let warnedNoMenu = false;
/** Said once: without Obsidian's bottom menu the tool buttons have nowhere to go (the shortcuts still work). */
function warnNoMenu(): void {
  if (warnedNoMenu) return;
  warnedNoMenu = true;
  new Notice('Canvas tool buttons aren’t available on this version of Obsidian. The keyboard shortcuts still work.');
}

/** Per-canvas-view state: the active tool, the card menu buttons, and click/drag placement. */
export class CanvasController {
  readonly view: CanvasViewLike;
  /** The document this canvas lives in: a canvas popped out into its own window has a different one from the main window. */
  readonly doc: Document;
  private tool: ToolId = 'select';
  /** Our buttons in Obsidian's bottom menu; null if Obsidian's menu can't be found. */
  private toolbar: CardMenu | null;
  private ghost: HTMLElement | null = null;
  private cleanups: Array<() => void> = [];
  private cancelDraw: (() => void) | null = null;
  private relations: RelationFlow;
  private panel: ContextPanel;
  private layers: LayersPanel;
  private minimap: Minimap;
  private tabPanels: CanvasPanels;
  private ink: InkTools;
  readonly presenter: Presenter;
  readonly focuser: Focuser;
  private tray: Tray;
  /** Owns the markdown renderers behind styled link nodes. */
  private component = new Component();

  constructor(private plugin: CanvasPlusPlugin, view: CanvasViewLike, panelStore: PanelStore) {
    this.view = view;
    this.doc = view.containerEl.doc;
    this.component.load();
    setCardOwner(view.canvas!, this.component);
    this.relations = new RelationFlow(plugin, view);
    this.panel = new ContextPanel(plugin, view);
    this.layers = new LayersPanel(plugin, view);
    this.minimap = new Minimap(plugin, view);
    this.tabPanels = new CanvasPanels(plugin, view, panelStore);
    // The layers panel covers the left edge. The minimap covers the lower-left corner, which matters only where it reaches past the panel.
    setInsets(view.canvas!, () => {
      const left = this.layers.insetPx;
      const corner = this.minimap.cornerPx;
      return { left, bottom: corner.width > left ? corner.height : 0 };
    });
    this.ink = new InkTools(view);
    this.cleanups.push(registerToolShortcuts(plugin.app, view, this));
    this.presenter = new Presenter(plugin, view, () => this.setTool('select'));
    // Added after the present button, so it sits just before it in the header.
    this.focuser = new Focuser(plugin, view);
    this.cleanups.push(attachUndoJournal(view.canvas!, plugin.app));
    this.cleanups.push(keepMenuClearOfLabels(view.canvas!));
    this.cleanups.push(watchSelection(view.canvas!, () => {
      this.panel.update();
      this.layers.update();
      this.injectKeyImage();
    }));
    const menuEl = view.canvas!.cardMenuEl ?? view.containerEl.querySelector<HTMLElement>('.canvas-card-menu');
    if (!menuEl) warnNoMenu();
    this.toolbar = menuEl
      ? new CardMenu(view.canvas!, menuEl, {
        onPick: (tool) => this.setTool(tool),
        onNoteClick: () => this.runAction('picker'),
        onPenColor: (color) => this.setPenColor(color),
        onNoteDrop: (pos) => this.dropNoteFromMenu(pos),
      })
      : null;
    this.toolbar?.setActive(this.tool);
    this.toolbar?.setNoteButtonVisible(plugin.hasNoteTypes);
    this.toolbar?.setPenColor(this.ink.penColor);

    const wrapper = view.canvas!.wrapperEl;
    // Capture phase, so an active placement tool pre-empts the canvas's own pan and marquee.
    for (const type of ['pointerdown', 'mousedown', 'dblclick'] as const) {
      const handler = (e: Event): void => this.onPointer(type, e as PointerEvent);
      wrapper.addEventListener(type, handler, true);
      this.cleanups.push(() => wrapper.removeEventListener(type, handler, true));
    }
    // Free text grows as it is typed into.
    const onInput = (e: Event): void => {
      const canvas = this.view.canvas;
      const node = canvas && freeTextAt(canvas, e.target);
      if (canvas && node) fitFreeText(canvas, node);
    };
    wrapper.addEventListener('input', onInput, true);
    this.cleanups.push(() => wrapper.removeEventListener('input', onInput, true));
    // Dropping an image on a note card sets its key image. Elsewhere the canvas handles the drop itself.
    for (const type of ['dragover', 'drop'] as const) {
      const handler = (e: DragEvent): void => this.onDrag(type, e);
      wrapper.addEventListener(type, handler, true);
      this.cleanups.push(() => wrapper.removeEventListener(type, handler, true));
    }
    // A connection drag runs on window listeners, so watch it from the document.
    const down = (e: PointerEvent): void => this.relations.onPointerDown(e);
    const up = (): void => this.relations.onPointerUp();
    const doc = this.doc;
    doc.addEventListener('pointerdown', down, true);
    doc.addEventListener('pointerup', up, true);
    this.cleanups.push(() => {
      doc.removeEventListener('pointerdown', down, true);
      doc.removeEventListener('pointerup', up, true);
    });
    // Last: its button joins the toolbar after the drawing tools, and it leaves presses an armed tool took alone.
    this.tray = new Tray(plugin, view, this.tabPanels, menuEl, () => this.sweep());
  }

  setTool(tool: ToolId): void {
    this.cancelDraw?.();
    this.tool = tool;
    this.toolbar?.setActive(tool);
    this.view.contentEl.toggleClass('ffc-tool-placing', isPlacementTool(tool) || isInkTool(tool));
  }

  private setPenColor(color: string): void {
    this.ink.penColor = color;
    this.toolbar?.setPenColor(color);
  }

  /** The note button was dragged onto the canvas and dropped: pick a note to put there, centred on the drop. */
  private dropNoteFromMenu(pos: { x: number; y: number }): void {
    const canvas = this.view.canvas;
    if (!canvas) return;
    this.openPicker(canvas, { x: pos.x + SIZE_NOTE_CARD.width / 2, y: pos.y + SIZE_NOTE_CARD.height / 2 });
  }

  runAction(action: ActionId): void {
    if (action === 'picker' && this.view.canvas) this.openPicker(this.view.canvas);
  }

  /** The note picker lists typed notes, so it needs Note Types. */
  private openPicker(canvas: CanvasLike, at?: { x: number; y: number }): void {
    if (!this.plugin.hasNoteTypes) {
      new Notice('Enable the Note Types plugin to add typed notes.');
      return;
    }
    new NotePicker(this.plugin, canvas, at).open();
  }

  /** Flip the selected note cards between card and embed. Returns false when none are selected. */
  toggleSelectedCards(): boolean {
    const canvas = this.view.canvas;
    if (!canvas) return false;
    const nodes = selectedNodes(canvas).filter((n) => noteOfNode(n) && n.nodeEl?.hasAttribute('data-ffc-note-type'));
    if (nodes.length === 0) return false;
    toggleViews(canvas, nodes);
    this.sweep();
    return true;
  }

  /**
   * Esc: abandon an in-progress draw and return to Select, or else, with nothing selected (core's Esc deselects),
   * bring Obsidian's panels back from focus. Returns whether it did anything.
   */
  escape(): boolean {
    if (this.tool !== 'select' || this.cancelDraw) {
      this.setTool('select');
      return true;
    }
    if (this.focuser.focused && (this.view.canvas?.selection?.size ?? 0) === 0) {
      this.focuser.stop();
      return true;
    }
    return false;
  }

  /** Tag node elements so CSS can style them: free text has no card chrome, note cards get a type chip. */
  sweep(): void {
    const canvas = this.view.canvas;
    const nodes = canvas?.nodes;
    if (!canvas || !nodes) return;
    this.toolbar?.setNoteButtonVisible(this.plugin.hasNoteTypes);
    decorateNoteCards(this.plugin, canvas);
    this.relations.sweep();
    this.panel.update();
    this.layers.update();
    this.presenter.refresh();
    this.tray.sync();
    this.injectKeyImage();
    fitAllFreeText(canvas);
    for (const node of nodes.values()) {
      const el = node.nodeEl;
      if (!el) continue;
      // Read once: every check below would otherwise copy the node's data again.
      const data = node.getData?.();
      const ink = readInk(node, data);
      const kind = ink ? 'ink' : getExtra(node, FIELD_KIND, data);
      if (typeof kind === 'string') el.setAttribute('data-ffc-kind', kind);
      else el.removeAttribute('data-ffc-kind');
      if (ink) this.syncInk(node, ink);
      if (isAnchor(node, data)) syncAnchor(canvas, node, data);
      else clearAnchor(node);
    }
  }

  destroy(): void {
    this.presenter.destroy();
    this.focuser.destroy();
    this.tray.destroy();
    this.cancelDraw?.();
    this.relations.destroy();
    this.panel.destroy();
    this.layers.destroy();
    this.minimap.destroy();
    this.tabPanels.destroy();
    for (const fn of this.cleanups) fn();
    this.cleanups = [];
    this.toolbar?.destroy();
    this.view.contentEl.removeClass('ffc-tool-placing');
    for (const node of this.view.canvas?.nodes?.values() ?? []) {
      node.nodeEl?.removeAttribute('data-ffc-kind');
      clearAnchor(node);
      if (Object.prototype.hasOwnProperty.call(node, 'startEditing')) Reflect.deleteProperty(node, 'startEditing');
    }
    if (this.view.canvas) {
      setInsets(this.view.canvas, null);
      clearNoteCards(this.view.canvas);
      setCardOwner(this.view.canvas, null);
    }
    this.component.unload();
  }

  /**
   * A stroke is a text node, so double-click would open its SVG source: turn
   * editing off. The SVG also carries its colour, so keep it in step with the
   * node's colour when that is changed from the canvas's own colour menu.
   */
  private syncInk(node: CanvasNodeLike, ink: NonNullable<ReturnType<typeof readInk>>): void {
    if (!Object.prototype.hasOwnProperty.call(node, 'startEditing')) node.startEditing = () => { /* strokes aren't edited as text */ };
    const canvas = this.view.canvas;
    const hex = colorToHex(node.getData?.().color);
    // Compare just the fill; rebuilding the outline every sweep would be wasteful with many strokes.
    const current = /fill="([^"]*)"/.exec(node.text ?? '')?.[1];
    if (!canvas || current === (hex ?? INK_FALLBACK_HEX)) return;
    patchData(node, { text: inkSvg(ink, hex) });
    canvas.requestSave?.(false);
  }

  /** The buttons this plugin adds to the canvas's selection pop-up menu. */
  private injectKeyImage(): void {
    const canvas = this.view.canvas;
    if (!canvas) return;
    const selected = selectedNodes(canvas);
    injectViewToggleButton(canvas, selected, () => this.sweep());
    injectKeyImageButton(this.plugin, canvas, selected);
  }

  /** The note card under a drag event, if any. */
  private cardAt(e: DragEvent): CanvasNodeLike | undefined {
    const el = isElement(e.target) ? e.target.closest<HTMLElement>('.canvas-node') : null;
    if (!el?.hasAttribute('data-ffc-note-type')) return undefined;
    return [...(this.view.canvas?.nodes?.values() ?? [])].find((n) => n.nodeEl === el);
  }

  private onDrag(type: 'dragover' | 'drop', e: DragEvent): void {
    const node = this.cardAt(e);
    const canvas = this.view.canvas;
    const source = node && canvas ? imageFromDrop(e.dataTransfer) : null;
    if (!node || !canvas || !source) {
      if (type === 'drop') this.fitDroppedCards();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (type === 'drop') void setKeyImage(this.plugin, canvas, node, source);
  }

  /**
   * The canvas handles a drop itself (a note dragged in from the file explorer, say). Once it has
   * added the nodes, fit any new note cards, the same as cards added from the note picker.
   */
  private fitDroppedCards(): void {
    const canvas = this.view.canvas;
    if (!canvas) return;
    const before = new Set(canvas.nodes?.keys() ?? []);
    const check = (): boolean => {
      const added = [...(canvas.nodes?.values() ?? [])].filter((n) => n.id && !before.has(n.id));
      for (const node of added) {
        const file = noteOfNode(node);
        if (file && this.plugin.types.getNoteTypeForFile(file)) fitNodeToCard(this.plugin, canvas, node);
      }
      return added.length > 0;
    };
    window.requestAnimationFrame(() => eachFrameUntil(check, 29));
  }

  private onPointer(type: 'pointerdown' | 'mousedown' | 'dblclick', e: PointerEvent): void {
    const tool = this.tool;
    if (isElement(e.target) && e.target.closest(NATIVE_CANVAS_UI)) return;
    if (isInkTool(tool)) {
      // Only the primary button of a mouse or pen draws. Touch and the middle button still pan the canvas.
      if (e.button !== 0 || e.pointerType === 'touch') return;
      e.preventDefault();
      e.stopPropagation();
      if (type === 'pointerdown') {
        this.cancelDraw?.();
        const end = (): void => { this.cancelDraw = null; };
        this.cancelDraw = tool === 'eraser' ? this.ink.beginErase(e, end) : this.ink.beginDraw(tool, e, end);
      }
      return;
    }
    if (!isPlacementTool(tool)) return;
    // Swallow the whole press so the canvas neither pans, marquees nor makes its own card.
    e.preventDefault();
    e.stopPropagation();
    if (type !== 'pointerdown' || e.button !== 0) return;
    this.beginDraw(tool, e);
  }

  /** Create the node, go back to Select, and style it now and once it has mounted. */
  private place(tool: PlaceTool, rect: PlacedRect): void {
    placeNode(this.view.canvas!, tool, rect);
    this.setTool('select');
    this.sweep();
    window.requestAnimationFrame(() => this.sweep());
  }

  /** A click places the tool's node at its default size; a drag draws its box (for an anchor, a frame). */
  private beginDraw(tool: PlaceTool, down: PointerEvent): void {
    const canvas = this.view.canvas!;
    const start = toCanvasPoint(canvas, down);
    if (!start) return;

    const doc = this.doc;
    const ghost = this.ghost = doc.body.createDiv({ cls: 'ffc-canvas-ghost' });
    const moveGhost = (e: PointerEvent): void => {
      ghost.setCssProps({
        '--ffc-x': `${Math.min(down.clientX, e.clientX)}px`,
        '--ffc-y': `${Math.min(down.clientY, e.clientY)}px`,
        '--ffc-w': `${Math.abs(e.clientX - down.clientX)}px`,
        '--ffc-h': `${Math.abs(e.clientY - down.clientY)}px`,
      });
    };
    let dragged = false;
    const onMove = (e: PointerEvent): void => {
      if (!dragged && Math.hypot(e.clientX - down.clientX, e.clientY - down.clientY) < CLICK_SLOP_PX) return;
      dragged = true;
      ghost.addClass('is-visible');
      moveGhost(e);
    };
    const stopTracking = trackPointer(doc, down.pointerId, {
      move: onMove,
      up: (e) => {
        finish();
        const end = dragged ? toCanvasPoint(canvas, e) : null;
        this.place(tool, placementRect(tool, start, end));
      },
      // A cancelled pointer (touch gesture taking over, pen out of range) abandons the draw.
      cancel: () => this.setTool('select'),
    });
    const finish = (): void => {
      stopTracking();
      ghost.remove();
      this.ghost = null;
      this.cancelDraw = null;
    };
    this.cancelDraw = finish;
  }
}
