import { CanvasLike, CanvasNodeLike, CanvasViewLike, afterCanvasFrame, batch, selectedNodes, shieldFromCanvas, toCanvasPoint, watchSelection } from './adapter.ts';
import { CLICK_SLOP_PX, TARGET_CLASS } from './constants.ts';
import { OverlayFrame } from './overlay-frame.ts';
import { trackPointer } from './pointer-session.ts';
import { Placed, placedAt, swapMoves } from './swap.ts';

const placedOf = (node: CanvasNodeLike): Placed<CanvasNodeLike> | null => {
  const { x, y, width, height } = node;
  if (x === undefined || y === undefined || width === undefined || height === undefined) return null;
  return { node, box: { x, y, width, height }, group: node.getData?.().type === 'group' };
};

/** The node's place and size, for every node of `nodes` that has them. */
const placedAll = (nodes: Iterable<CanvasNodeLike>): Array<Placed<CanvasNodeLike>> =>
  Array.from(nodes, placedOf).filter((p): p is Placed<CanvasNodeLike> => p !== null);

/** A dot being carried, and the shadow that goes with it. */
interface Carry {
  node: CanvasNodeLike;
  ghost: HTMLElement;
}

/**
 * Figma's handles for a multiple selection: a dot on each selected node. Dragging a dot onto another selected
 * node swaps the two, each taking the other's place (centre to centre), as one undo step.
 */
export class SelectionHandles {
  private el: HTMLElement;
  private frame: OverlayFrame;
  private dots = new Map<CanvasNodeLike, HTMLElement>();
  /** What each dot was last given, so a frame that didn't move it writes nothing. */
  private lastPlace = new WeakMap<HTMLElement, string>();
  private cleanups: Array<() => void> = [];
  private endDrag: (() => void) | null = null;
  /** The dot being carried, which `layout` leaves to the pointer. */
  private carry: Carry | null = null;

  constructor(private view: CanvasViewLike) {
    const canvas = view.canvas!;
    this.el = view.contentEl.createDiv({ cls: 'ffc-handles' });
    shieldFromCanvas(this.el);
    this.frame = new OverlayFrame(canvas, this.el);
    this.cleanups.push(() => this.frame.destroy());
    this.cleanups.push(afterCanvasFrame(canvas, () => this.sync()));
    this.cleanups.push(watchSelection(canvas, () => this.sync()));
    this.sync();
  }

  private get canvas(): CanvasLike { return this.view.canvas!; }

  destroy(): void {
    this.endDrag?.();
    for (const fn of this.cleanups) fn();
    this.cleanups = [];
    this.el.remove();
  }

  /** Show a dot on each selected node while two or more are selected, and keep each on its node's centre. */
  sync(): void {
    const canvas = this.canvas;
    const nodes = canvas.readonly ? [] : selectedNodes(canvas).filter((n) => n.nodeEl?.isConnected && placedOf(n));
    const shown = new Set(nodes.length >= 2 ? nodes : []);
    // A selection that no longer holds the carried node ends the drag, which would otherwise go on with no dot.
    if (this.carry && !shown.has(this.carry.node)) this.endDrag?.();
    for (const [node, dot] of this.dots) {
      if (shown.has(node)) continue;
      dot.remove();
      this.dots.delete(node);
    }
    for (const node of shown) {
      if (!this.dots.has(node)) this.dots.set(node, this.drawDot(node));
    }
    this.layout();
  }

  private drawDot(node: CanvasNodeLike): HTMLElement {
    const dot = this.el.createDiv({ cls: 'ffc-handle', attr: { 'aria-label': 'Drag onto another selected object to swap places' } });
    dot.addEventListener('pointerdown', (e) => this.press(node, dot, e));
    return dot;
  }

  private layout(): void {
    const view = this.frame.project();
    if (!view) return;
    const { left, top, minX, minY, zoom } = view;
    for (const [node, dot] of this.dots) {
      const p = placedOf(node);
      if (!p || node === this.carry?.node) continue;
      const x = `${(p.box.x + p.box.width / 2 - minX) * zoom + left}px`;
      const y = `${(p.box.y + p.box.height / 2 - minY) * zoom + top}px`;
      if (this.lastPlace.get(dot) === `${x} ${y}`) continue;
      this.lastPlace.set(dot, `${x} ${y}`);
      dot.setCssProps({ '--ffc-x': x, '--ffc-y': y });
    }
    // The view may zoom while a dot is carried.
    const carried = this.carry && placedOf(this.carry.node);
    if (this.carry && carried) {
      this.carry.ghost.setCssProps({ '--ffc-w': `${carried.box.width * zoom}px`, '--ffc-h': `${carried.box.height * zoom}px` });
    }
  }

  /** A press on a dot: carrying it onto another selected node and letting go swaps the two. */
  private press(node: CanvasNodeLike, dot: HTMLElement, down: PointerEvent): void {
    if (down.button !== 0) return;
    down.preventDefault();
    this.endDrag?.();
    const targets = placedAll(selectedNodes(this.canvas).filter((n) => n !== node));
    let moved = false;
    let target: CanvasNodeLike | undefined;
    // A shadow of the node follows the dot, so it shows what is being carried.
    const ghost = this.el.createDiv({ cls: 'ffc-handle-ghost' });
    const mark = (next: CanvasNodeLike | undefined): void => {
      if (next === target) return;
      target?.nodeEl?.removeClass(TARGET_CLASS);
      next?.nodeEl?.addClass(TARGET_CLASS);
      target = next;
    };
    const finish = (): void => {
      stop();
      mark(undefined);
      ghost.remove();
      dot.removeClass('is-dragging');
      this.carry = null;
      this.endDrag = null;
      this.layout();
    };
    const stop = trackPointer(this.view.containerEl.doc, down.pointerId, {
      move: (e) => {
        if (!moved && Math.hypot(e.clientX - down.clientX, e.clientY - down.clientY) < CLICK_SLOP_PX) return;
        moved = true;
        this.carry = { node, ghost };
        dot.addClass('is-dragging');
        const host = this.el.getBoundingClientRect();
        const at = { '--ffc-x': `${e.clientX - host.left}px`, '--ffc-y': `${e.clientY - host.top}px` };
        dot.setCssProps(at);
        ghost.setCssProps(at);
        ghost.addClass('is-shown');
        this.layout();
        const p = toCanvasPoint(this.canvas, e);
        mark(p ? placedAt(targets, p)?.node : undefined);
      },
      up: () => {
        const to = target;
        finish();
        const a = placedOf(node);
        const b = to && placedOf(to);
        if (!moved || !a || !b) return;
        const rest = placedAll(this.canvas.nodes?.values() ?? []);
        batch(this.canvas, () => {
          for (const move of swapMoves(a, b, rest)) move.node.moveAndResize?.(move.box);
        });
      },
      cancel: finish,
    });
    this.endDrag = finish;
  }
}
