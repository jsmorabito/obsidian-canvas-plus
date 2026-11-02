import { Platform, TFile } from 'obsidian';
import type { CanvasPlusPlugin } from '../main.ts';
import { CanvasLike, CanvasNodeLike, CanvasViewLike, draggedNodes, removeNode } from './adapter.ts';
import { CLICK_SLOP_PX } from './constants.ts';
import { diagramHost } from './diagram-card.ts';
import { readIssueRef } from './issue-ref.ts';
import { Dropped, KanbanEditor } from './kanban-editor.ts';
import { DROP_COLUMN_CLASS, Slot, chooseSlot, placeIndicator } from './kanban-slot.ts';
import { describe } from './layers-tree.ts';
import { trackPointer } from './pointer-session.ts';
import { trayItemsFrom } from './tray-items.ts';

/** The most of a text card's words a kanban card takes. */
const MAX_WORDS = 120;

/** Where a carried card would go: the board, and the slot in it. */
interface Aim {
  node: CanvasNodeLike;
  slot: Slot;
  host: HTMLElement;
  unit: number;
  columnEl: SVGElement;
}

/** What a kanban card says for a canvas card, before the board holds the canvas card itself. */
type Words = Omit<Dropped, 'held'>;

/**
 * Cards carried over a kanban board from the canvas. While one is dragged over the board, the column under it is
 * lit and a line shows where it will land; let go, and the card moves into the board: the board shows a card that
 * links to it (a note, or the issue's web address) or says the text card's words, and holds the canvas card itself,
 * which comes back when that card is dragged out of the board.
 */
export class KanbanDrop {
  constructor(private plugin: CanvasPlusPlugin, private view: CanvasViewLike, private editor: KanbanEditor) {}

  private get canvas(): CanvasLike { return this.view.canvas!; }

  /** Listen on the canvas for presses that become drags of cards. Returns what removes the listener. */
  attach(): () => void {
    const wrapper = this.canvas.wrapperEl;
    const press = (e: Event): void => this.onPress(e as PointerEvent);
    // After the controller's and the tray's own listeners, so a press an armed tool has taken is left alone.
    wrapper.addEventListener('pointerdown', press, true);
    return () => {
      wrapper.removeEventListener('pointerdown', press, true);
      this.stop();
    };
  }

  private stop: () => void = () => { /* no drag to watch */ };

  /** The kanban cards on the canvas. */
  private boards(): CanvasNodeLike[] {
    return [...(this.canvas.nodes?.values() ?? [])].filter((n) => n.nodeEl?.hasAttribute('data-ffc-kanban'));
  }

  private onPress(down: PointerEvent): void {
    const canvas = this.canvas;
    if (down.button !== 0 || down.defaultPrevented || canvas.readonly) return;
    const boards = this.boards();
    if (boards.length === 0) return;
    this.stop();
    let carried: Array<{ node: CanvasNodeLike; item: Words }> | null = null;
    let ignored = false;
    let aim: Aim | null = null;
    let indicator: HTMLElement | null = null;

    const clear = (): void => {
      indicator?.remove();
      indicator = null;
      aim?.columnEl.removeClass(DROP_COLUMN_CLASS);
      aim = null;
    };
    const finish = (): void => {
      clear();
      end();
      this.stop = () => { /* no drag to watch */ };
    };
    const end = trackPointer(this.view.containerEl.doc, down.pointerId, {
      move: (e) => {
        if (ignored) return;
        if (!carried) {
          if (Math.hypot(e.clientX - down.clientX, e.clientY - down.clientY) < CLICK_SLOP_PX) return;
          const nodes = draggedNodes(canvas);
          // Core hasn't started carrying anything yet.
          if (nodes.length === 0) return;
          const items = nodes.map((node) => ({ node, item: this.describeNode(node) }));
          // A board carried over a board, or nothing a card can say, isn't a drop.
          if (nodes.some((n) => boards.includes(n)) || !items.some((i) => i.item)) {
            ignored = true;
            return;
          }
          carried = items.flatMap(({ node, item }) => (item ? [{ node, item }] : []));
        }
        const next = this.aimAt(e, boards);
        if (next && next.node === aim?.node && next.slot.column.i === aim.slot.column.i && next.slot.before === aim.slot.before) return;
        clear();
        aim = next;
        if (!next) return;
        next.columnEl.addClass(DROP_COLUMN_CLASS);
        indicator = next.host.createDiv({ cls: 'ffc-mm-drop' });
        placeIndicator(next.host, indicator, next.slot, next.unit);
      },
      up: (e) => {
        const target = aim ? { node: aim.node, column: aim.slot.column.i, before: aim.slot.before } : null;
        const taken = carried;
        finish();
        // Core's alt (Ctrl on Windows and Linux) drag leaves the cards and drops copies, which stay where they fall.
        const copying = Platform.isMacOS ? e.altKey : e.ctrlKey;
        if (!target || !taken || copying) return;
        // Once core has finished its drag, so the cards go as part of it.
        window.setTimeout(() => this.drop(target, taken), 0);
      },
      cancel: finish,
    });
    this.stop = finish;
  }

  /** Where the carried cards would go for a pointer: over a board, the slot it gives. */
  private aimAt(e: PointerEvent, boards: CanvasNodeLike[]): Aim | null {
    for (const node of boards) {
      const host = diagramHost(node);
      const rect = host?.getBoundingClientRect();
      if (!host || !rect || e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) continue;
      const view = this.editor.boardView(node);
      const slot = view && chooseSlot(view.columns, e.clientX, e.clientY, view.unit);
      if (!view || !slot) continue;
      return { node, slot, host, unit: view.unit, columnEl: view.columnEls[slot.column.i] };
    }
    return null;
  }

  /** Add the cards to the board, which holds the carried cards, and take them off the canvas, in the same undo step. */
  private drop(
    target: { node: CanvasNodeLike; column: number; before?: number },
    taken: Array<{ node: CanvasNodeLike; item: Words }>,
  ): void {
    const canvas = this.canvas;
    if (!canvas.nodes?.get(target.node.id ?? '')) return;
    const nodes: CanvasNodeLike[] = [];
    const items: Dropped[] = [];
    for (const { node, item } of taken) {
      if (!node.id || canvas.nodes.get(node.id) !== node) continue;
      const held = trayItemsFrom(this.plugin, canvas, [node])[0];
      if (!held) continue;
      nodes.push(node);
      items.push({ ...item, held });
    }
    if (items.length === 0) return;
    this.editor.addDropped(target.node, target.column, target.before, items, () => {
      canvas.deselectAll?.();
      for (const node of nodes) removeNode(canvas, node);
    });
  }

  /** What a kanban card made from a canvas card says, or null for the cards that can't become one (a drawing, a group, a diagram, an image). */
  private describeNode(node: CanvasNodeLike): Words | null {
    const issue = readIssueRef(node);
    if (issue) return { words: `${issue.identifier} ${issue.title}`.trim() || issue.id, url: issue.url };
    const layer = describe(this.plugin, node);
    switch (layer.kind) {
      case 'note':
      case 'file': {
        const path = node.getData?.().file;
        const file = node.file ?? (typeof path === 'string' ? this.plugin.app.vault.getAbstractFileByPath(path) : null);
        return file instanceof TFile ? { words: file.basename, file } : null;
      }
      case 'link':
        return layer.url ? { words: layer.label, url: layer.url } : null;
      case 'text':
      case 'card': {
        const words = (node.text ?? '').trim().split('\n').find((l) => l.trim())?.trim().slice(0, MAX_WORDS) ?? '';
        return words ? { words } : null;
      }
      default:
        return null;
    }
  }
}
