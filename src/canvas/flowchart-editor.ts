import { Menu, Notice, TFile, setIcon } from 'obsidian';
import type { ProviderId } from '../issues/types.ts';
import { CanvasNodeLike, isElement } from './adapter.ts';
import { CLICK_SLOP_PX } from './constants.ts';
import { TypeSource, createNoteFromText } from './convert-card.ts';
import { diagramHost } from './diagram-card.ts';
import { DiagramLinks, readDiagram } from './diagram-data.ts';
import { addExportItems } from './diagram-export.ts';
import { plainText } from './diagram-links.ts';
import {
  EdgeStyle, FLOW_SHAPES, FlowShape, Flowchart, addEdge, addFirstNode, addNode, colorClassOf, descendantsOf, edgeLabelOf, edgeStyleOf, labelOf,
  moveAmongSiblings, nodeIds, parentOf, readFlowchart, removeEdge, removeNode, renameNode, reparentNode, setDirection, setEdgeLabel,
  setEdgeStyle, setNodeColorClass, setNodeShape, shapeOfNode, siblingsOf,
} from './flowchart-edit.ts';
import { Placement, Side, OPPOSITE, chooseDrop, forwardOf } from './drop-zones.ts';
import { DiagramEditorBase } from './diagram-editor-base.ts';
import { DotSpec } from './floating-tools.ts';
import { openInPlaceField } from './in-place-field.ts';
import { createIssueFromText } from './issue-create.ts';
import { LinkPicker } from './link-picker.ts';
import { TEXT_FORMATS, TextFormat, toggleFormat } from './mindmap-format.ts';
import { colorFromToken, colorToken } from './node-colors.ts';
import { trackPointer } from './pointer-session.ts';
import { ShapeOption, addColorButton, addCreateButtons, addFormatButtons, addShapeButton, toolButton } from './toolbar-parts.ts';
import type { SideEffect } from './undo-journal.ts';

const CARD = '.canvas-node[data-ffc-flowchart]';
const ACTIVE_CLASS = 'ffc-mm-active';
const PICKED_CLASS = 'ffc-fc-node-picked';
/** Set on a card while a node or an edge is picked in it, which hides the card's outline. */
const PICKED_ATTR = 'data-ffc-picked';
const DROP_TARGET_CLASS = 'ffc-mm-drop-target';
const DRAGGING_CLASS = 'ffc-mm-dragging';

/** What a drag measures once, when it starts: the chart, which nodes are the dragged node's siblings, and every node it could land on. */
interface DragContext {
  flow: Flowchart;
  siblings: Set<string>;
  /** The side of a node the chart runs out of. */
  forward: Side;
  targets: Array<{ id: string; el: Element; rect: DOMRect }>;
}

/** A flowchart's labels take HTML tags where a mindmap's take markdown marks. */
const TAGS: Record<string, [string, string]> = {
  bold: ['<b>', '</b>'], italic: ['<i>', '</i>'], underline: ['<u>', '</u>'], code: ['<code>', '</code>'],
};
const FLOW_FORMATS: readonly TextFormat[] = TEXT_FORMATS.map((f) => (TAGS[f.id] ? { ...f, open: TAGS[f.id][0], close: TAGS[f.id][1] } : f));

const SHAPE_LABELS: Record<FlowShape, string> = {
  rect: 'Rectangle', rounded: 'Rounded', stadium: 'Stadium', subroutine: 'Subroutine', cylinder: 'Cylinder', circle: 'Circle',
  'double-circle': 'Double circle', asymmetric: 'Flag', diamond: 'Diamond', hexagon: 'Hexagon', parallelogram: 'Parallelogram',
  'parallelogram-alt': 'Parallelogram, leaning back', trapezoid: 'Trapezoid', 'trapezoid-alt': 'Trapezoid, upside down',
};
const SHAPE_OPTIONS: Array<ShapeOption<FlowShape>> = (Object.keys(FLOW_SHAPES) as FlowShape[]).map((id) => ({ id, label: SHAPE_LABELS[id] }));

const EDGE_STYLES: Array<[EdgeStyle, string, string]> = [['arrow', 'Arrow', 'move-right'], ['line', 'Line', 'minus'], ['dotted', 'Dotted', 'ellipsis'], ['thick', 'Thick', 'equal']];
const DIRECTIONS: Array<[string, string]> = [['LR', 'Left to right'], ['TD', 'Top to bottom'], ['RL', 'Right to left'], ['BT', 'Bottom to top']];

type Pick = { kind: 'node'; id: string } | { kind: 'edge'; domId: string };
interface Live {
  node: CanvasNodeLike;
  flow: Flowchart;
  pick: Pick;
}

/** Whether all of `text` has `format` on. */
function isOn(text: string, format: TextFormat): boolean {
  return toggleFormat(text, 0, text.length, format).value.length < text.length;
}

/**
 * Edit a flowchart in its diagram card, on the canvas: pick a node or an edge by clicking it, and change it with the
 * toolbar, the dots round a node (one click adds a node after, before or beside it; dragging from a dot to another node
 * joins them), a double-click (to rename a node or label an edge), or the keys. Every change is written into the
 * Mermaid source as one undo step, so the source stays the only record of the flowchart.
 */
export class FlowchartEditor extends DiagramEditorBase {
  protected readonly cardSelector = CARD;
  private active: { node: CanvasNodeLike; pick: Pick } | null = null;
  /** A node being dragged to a new place in the chart. */
  private drag: { el: Element; indicator: HTMLElement; target: { id: string; place: Placement; el: Element } | null } | null = null;

  /** Listen on the canvas for presses on a flowchart's nodes and edges. Returns what removes the listeners. */
  attach(): () => void {
    const wrapper = this.canvas.wrapperEl;
    const on: Array<[string, (e: Event) => void]> = [
      ['pointerdown', (e) => this.onDown(e as PointerEvent)],
      ['dblclick', (e) => this.onDoubleClick(e as MouseEvent)],
      ['click', (e) => this.onLinkClick(e as MouseEvent)],
      ['contextmenu', (e) => this.onContextMenu(e as MouseEvent)],
      ['mouseover', (e) => this.onHover(e as MouseEvent)],
    ];
    for (const [type, handler] of on) wrapper.addEventListener(type, handler, true);
    return () => {
      for (const [type, handler] of on) wrapper.removeEventListener(type, handler, true);
      this.stopFollowing();
      this.closeField();
      this.active = null;
      this.paint();
      this.tools.clear();
    };
  }

  // ── What is picked ─────────────────────────────────────────────────────────

  private cardNode(el: Element | null): CanvasNodeLike | undefined {
    return el ? [...(this.canvas.nodes?.values() ?? [])].find((n) => n.nodeEl === el) : undefined;
  }

  /** The node or edge under a press, in a flowchart card. */
  private hit(target: EventTarget | null): { node: CanvasNodeLike; pick: Pick } | null {
    if (!isElement(target)) return null;
    const node = this.cardNode(target.closest(CARD));
    if (!node) return null;
    const nodeEl = target.closest('.pele-node');
    if (nodeEl?.getAttribute('data-id')) return { node, pick: { kind: 'node', id: nodeEl.getAttribute('data-id') ?? '' } };
    const edgeEl = target.closest('.pele-edge, .pele-edge-label');
    return edgeEl?.getAttribute('data-id') ? { node, pick: { kind: 'edge', domId: edgeEl.getAttribute('data-id') ?? '' } } : null;
  }

  /** The picked node or edge, checked against the card's source as it is now. */
  private current(): Live | null {
    const active = this.active;
    if (!active || !this.isOnlySelected(active.node)) return null;
    const diagram = readDiagram(active.node);
    const flow = diagram && readFlowchart(diagram.source);
    if (!flow) return null;
    const { pick } = active;
    const there = pick.kind === 'node' ? flow.ids.has(pick.id) : flow.edges.some((e) => e.domId === pick.domId);
    return there ? { node: active.node, flow, pick } : null;
  }

  private onDown(e: PointerEvent): void {
    if (isElement(e.target) && e.target.closest('.ffc-mm-input, .ffc-mm-tools, .ffc-mm-toolbar')) return;
    this.stopFollowing();
    const hit = this.hit(e.target);
    this.linkPress = hit?.pick.kind === 'node'
      ? { x: e.clientX, y: e.clientY, wasActive: this.active?.node === hit.node && this.active.pick.kind === 'node' && this.active.pick.id === hit.pick.id }
      : null;
    if (!hit) {
      this.deselect();
      return;
    }
    if (this.explainUnreadable(hit.node)) return;
    // A multi-select press leaves the flowchart alone.
    if (e.button !== 0 || e.shiftKey || e.metaKey || e.ctrlKey) return;
    this.closeField();
    // Pick on the press itself, without waiting for core to select the card: select it here, and draw now.
    const selection = this.canvas.selection;
    if (!selection?.has(hit.node)) this.canvas.selectOnly?.(hit.node);
    else if (selection.size > 1) return;
    this.active = hit;
    this.paint();
    // A node with an edge into it is dragged to rearrange the chart: core never sees the press. A node at the start
    // of the chart has nothing to rearrange, so dragging it moves the card.
    if (hit.pick.kind === 'node' && this.parentOfNode(hit.node, hit.pick.id) !== null) {
      e.stopPropagation();
      this.followDrag(e, hit.node, hit.pick.id);
      return;
    }
    // A press that turns into a drag is moving the card, not picking.
    this.stopFollowing = trackPointer(this.view.containerEl.doc, e.pointerId, {
      move: (move) => {
        if (Math.hypot(move.clientX - e.clientX, move.clientY - e.clientY) > CLICK_SLOP_PX) {
          this.stopFollowing();
          this.deselect();
        }
      },
      up: () => this.stopFollowing(),
      cancel: () => this.stopFollowing(),
    });
  }

  private parentOfNode(node: CanvasNodeLike, id: string): string | null {
    const diagram = readDiagram(node);
    const flow = diagram && readFlowchart(diagram.source);
    return flow ? parentOf(flow, id) : null;
  }

  /** Charts already told about, by the source they had, so a click isn't a notice each time. */
  private told = new WeakMap<CanvasNodeLike, string>();

  /**
   * When the card's source uses something the editor can't change safely, say which line, once. Returns whether it
   * is one of those, in which case nothing on the canvas can be picked.
   */
  private explainUnreadable(node: CanvasNodeLike): boolean {
    const diagram = readDiagram(node);
    const problem = { line: -1 };
    if (!diagram || readFlowchart(diagram.source, problem)) return false;
    if (this.told.get(node) !== diagram.source) {
      this.told.set(node, diagram.source);
      const text = problem.line >= 0 ? diagram.source.split('\n')[problem.line].trim().slice(0, 50) : '';
      new Notice(text
        ? `This flowchart can't be edited on the canvas: line ${problem.line + 1} (${text}) uses syntax the editor can't change safely. Edit its source instead.`
        : 'This flowchart can\'t be edited on the canvas. Edit its source instead.');
    }
    return true;
  }

  private stopFollowing: () => void = () => { /* no press to watch */ };

  /** Drag the node under the press to a new place: it follows the pointer, and a line (beside a sibling) or an outline (on a node) shows where it will go. */
  private followDrag(down: PointerEvent, node: CanvasNodeLike, id: string): void {
    const host = diagramHost(node);
    const el = this.nodeEl(node, id);
    if (!host || !el) return;
    const ctm = (el as SVGGraphicsElement).ownerSVGElement?.getScreenCTM();
    // Screen pixels per drawing unit.
    const unit = ctm && ctm.a > 0 ? ctm.a : 1;
    let started = false;
    let context: DragContext | null = null;

    const finish = (commit: boolean): void => {
      this.stopFollowing();
      const drag = this.drag;
      this.drag = null;
      if (!started || !drag) return;
      (el as SVGElement).setCssProps({ '--ffc-mm-drag': '' });
      el.removeClass(DRAGGING_CLASS);
      drag.indicator.remove();
      drag.target?.el.removeClass(DROP_TARGET_CLASS);
      const target = drag.target;
      if (!commit || !target) {
        this.paint();
        return;
      }
      this.change((now) => (target.place === 'inside' ? reparentNode(now.flow, id, target.id) : moveAmongSiblings(now.flow, id, target.id, target.place === 'before')));
      this.paint();
    };
    this.stopFollowing = trackPointer(this.view.containerEl.doc, down.pointerId, {
      move: (move) => {
        if (!started) {
          if (Math.hypot(move.clientX - down.clientX, move.clientY - down.clientY) <= CLICK_SLOP_PX) return;
          const live = this.current();
          if (!live) return;
          started = true;
          this.tools.clear();
          el.addClass(DRAGGING_CLASS);
          this.drag = { el, indicator: host.createDiv({ cls: 'ffc-mm-drop' }), target: null };
          // Nothing but the dragged node moves during the drag, so where the others are is read once.
          const below = descendantsOf(live.flow, id);
          context = {
            flow: live.flow,
            siblings: new Set(siblingsOf(live.flow, id)),
            forward: forwardOf(live.flow.direction),
            targets: nodeIds(live.flow).flatMap((other) => {
              const target = below.has(other) ? null : this.nodeEl(node, other);
              return target ? [{ id: other, el: target, rect: target.getBoundingClientRect() }] : [];
            }),
          };
        }
        if (!this.drag || !context) return;
        (el as SVGElement).setCssProps({ '--ffc-mm-drag': `${(move.clientX - down.clientX) / unit}px ${(move.clientY - down.clientY) / unit}px` });
        this.aim(this.drag, context, host, move);
      },
      up: () => finish(true),
      cancel: () => finish(false),
    });
  }

  /** Show where the dragged node would go: an outline on the node it is over (or nearest), and a bar on the side it goes. */
  private aim(drag: NonNullable<FlowchartEditor['drag']>, context: DragContext, host: HTMLElement, pointer: PointerEvent): void {
    const choice = chooseDrop(context.forward, context.siblings, context.targets, pointer.clientX, pointer.clientY);
    const target = choice && context.targets.find((t) => t.id === choice.id);
    drag.target?.el.removeClass(DROP_TARGET_CLASS);
    drag.indicator.addClass('is-hidden');
    drag.target = choice && target ? { id: choice.id, place: choice.place, el: target.el } : null;
    if (!choice || !target) return;
    target.el.addClass(DROP_TARGET_CLASS);
    const hostRect = host.getBoundingClientRect();
    const scale = host.offsetWidth > 0 ? hostRect.width / host.offsetWidth : 1;
    const { rect } = target;
    const { side } = choice;
    const vertical = side === 'left' || side === 'right';
    drag.indicator.removeClass('is-hidden');
    drag.indicator.toggleClass('is-vertical', vertical);
    drag.indicator.setCssProps(vertical
      ? {
        '--ffc-mm-left': `${((side === 'left' ? rect.left : rect.right) - hostRect.left) / scale}px`,
        '--ffc-mm-top': `${(rect.top - hostRect.top) / scale}px`,
        '--ffc-mm-height': `${rect.height / scale}px`,
      }
      : {
        '--ffc-mm-left': `${(rect.left - hostRect.left) / scale}px`,
        '--ffc-mm-top': `${((side === 'top' ? rect.top : rect.bottom) - hostRect.top) / scale}px`,
        '--ffc-mm-width': `${rect.width / scale}px`,
      });
  }

  private onDoubleClick(e: MouseEvent): void {
    const hit = this.hit(e.target);
    if (!hit || this.canvas.readonly) return;
    // Past core's own double-click, which would open the card's source.
    e.preventDefault();
    e.stopPropagation();
    this.active = hit;
    this.paint();
    this.rename();
  }

  // ── Keys ───────────────────────────────────────────────────────────────────

  /** Handle a key for the picked node or edge. Returns whether it was used. */
  handleKey(e: KeyboardEvent): boolean {
    const live = this.current();
    if (!live || this.canvas.readonly) return false;
    if (e.key === 'Escape') {
      this.deselect();
      return true;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return false;
    const node = live.pick.kind === 'node';
    if (e.key === 'Tab' && node) {
      this.addFrom(e.shiftKey ? 'before' : 'after');
      return true;
    }
    if (e.shiftKey) return false;
    if (e.key === 'Enter' || e.key === 'F2') {
      this.rename();
      return true;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      this.remove();
      return true;
    }
    return false;
  }

  /** Re-apply the highlight after the diagram has been drawn again, and let go when the card is no longer selected. */
  refresh(): void {
    if (this.active && !this.current()) this.deselect();
    else this.paint();
  }

  private deselect(): void {
    this.closeField();
    this.active = null;
    this.paint();
  }

  // ── Drawing what is picked ─────────────────────────────────────────────────

  private nodeEl(node: CanvasNodeLike, id: string): Element | null {
    return diagramHost(node)?.querySelector(`.pele-node[data-id="${CSS.escape(id)}"]`) ?? null;
  }

  /** An edge's label when it has one, else the edge. */
  private edgeEl(node: CanvasNodeLike, domId: string): Element | null {
    const host = diagramHost(node);
    return host?.querySelector(`.pele-edge-label[data-id="${CSS.escape(domId)}"]`) ?? host?.querySelector(`.pele-edge[data-id="${CSS.escape(domId)}"]`) ?? null;
  }

  private paint(): void {
    const wrapper = this.canvas.wrapperEl;
    for (const el of Array.from(wrapper.querySelectorAll(`${CARD} .${ACTIVE_CLASS}`))) el.removeClass(ACTIVE_CLASS);
    for (const el of Array.from(wrapper.querySelectorAll(`${CARD}[${PICKED_ATTR}]`))) el.removeAttribute(PICKED_ATTR);
    const live = this.current();
    // With something picked, its own toolbar is the one to use, not the card's, and the card shows no outline.
    wrapper.toggleClass(PICKED_CLASS, !!live);
    if (live) live.node.nodeEl?.setAttribute(PICKED_ATTR, '');
    if (!live) {
      this.tools.clear();
      return;
    }
    const host = diagramHost(live.node);
    const el = live.pick.kind === 'node' ? this.nodeEl(live.node, live.pick.id) : this.edgeEl(live.node, live.pick.domId);
    if (live.pick.kind === 'edge') host?.querySelector(`.pele-edge[data-id="${CSS.escape(live.pick.domId)}"]`)?.addClass(ACTIVE_CLASS);
    else el?.addClass(ACTIVE_CLASS);
    this.showTools(live, el);
  }

  private showTools(live: Live, el: Element | null): void {
    if (!el || this.field || this.drag) {
      this.tools.clear();
      return;
    }
    const forward = forwardOf(live.flow.direction);
    const key = `${live.node.id ?? ''}|${live.pick.kind === 'node' ? live.pick.id : live.pick.domId}|${live.flow.lines.join('\n')}`;
    const dots = live.pick.kind === 'node' ? this.dotsFor(forward, live.pick.id) : [];
    this.tools.show(el, key, dots, (bar) => (live.pick.kind === 'node' ? this.fillNodeBar(bar, live, live.pick.id) : this.fillEdgeBar(bar, live, live.pick.domId)));
  }

  /** Dots along the way the chart runs: one after the node, one before it, and one to the side for another branch. */
  private dotsFor(forward: Side, id: string): DotSpec[] {
    const gap = 14;
    const at: Record<Side, DotSpec['at']> = {
      right: (r) => ({ x: r.right + gap, y: r.top + r.height / 2 }),
      left: (r) => ({ x: r.left - gap, y: r.top + r.height / 2 }),
      bottom: (r) => ({ x: r.left + r.width / 2, y: r.bottom + gap }),
      top: (r) => ({ x: r.left + r.width / 2, y: r.top - gap }),
    };
    const across: Side = forward === 'left' || forward === 'right' ? 'bottom' : 'right';
    const spec = (label: string, place: DotSpec['at'], branch: 'after' | 'before' | 'branch'): DotSpec => ({
      label,
      at: place,
      run: () => this.addFrom(branch),
      press: (e) => this.connectFrom(e, id, branch === 'before' ? 'in' : 'out', () => this.addFrom(branch)),
    });
    return [spec('Add node after', at[forward], 'after'), spec('Add node before', at[OPPOSITE[forward]], 'before'), spec('Add branch', at[across], 'branch')];
  }

  private fillNodeBar(bar: HTMLElement, live: Live, id: string): void {
    const { flow } = live;
    addColorButton(bar, {
      chosen: colorFromToken(colorClassOf(flow, id) ?? ''),
      pick: (color) => this.change((now) => setNodeColorClass(now.flow, id, colorToken(color) || null)),
    });
    addShapeButton(bar, SHAPE_OPTIONS, shapeOfNode(flow, id), (shape) => this.change((now) => setNodeShape(now.flow, id, shape)));
    addFormatButtons(bar, (format) => isOn(labelOf(flow, id), format), (format) => this.applyFormat(format), FLOW_FORMATS);
    addCreateButtons(bar, this.plugin, { note: (source) => this.createNote(source), issue: (provider) => this.createIssue(provider) });
  }

  private fillEdgeBar(bar: HTMLElement, live: Live, domId: string): void {
    const style = edgeStyleOf(live.flow.edges.find((e) => e.domId === domId) ?? live.flow.edges[0]);
    for (const [id, label, icon] of EDGE_STYLES) {
      const button = toolButton(bar, label);
      setIcon(button, icon);
      if (id === style) button.addClass('is-active');
      button.addEventListener('click', (e) => {
        e.stopPropagation();
        this.change((now) => {
          const index = now.flow.edges.findIndex((edge) => edge.domId === domId);
          return index >= 0 ? setEdgeStyle(now.flow, index, id) : null;
        });
      });
    }
  }

  // ── Changing it ────────────────────────────────────────────────────────────

  /** Change the source with what the picked node or edge is now, or do nothing when `make` has nothing to change. */
  private change(make: (live: Live) => string | null, extra: { links?: DiagramLinks; effect?: SideEffect | null } = {}): void {
    const live = this.current();
    const source = live && make(live);
    if (live && source !== null) this.write(live.node, source, extra);
  }

  /** Add a node after, before or beside the picked one, and name it. */
  private addFrom(branch: 'after' | 'before' | 'branch'): void {
    const live = this.current();
    if (!live || live.pick.kind !== 'node' || this.canvas.readonly) return;
    const added = addNode(live.flow, live.pick.id, branch);
    this.write(live.node, added.source);
    this.active = { node: live.node, pick: { kind: 'node', id: added.id } };
    window.requestAnimationFrame(() => this.rename());
  }

  /**
   * Drag from a dot to another node to join them: out of the picked node, or into it for the dot before it. A press
   * that doesn't move is a click on the dot, which adds a node.
   */
  private connectFrom(down: PointerEvent, from: string, way: 'in' | 'out', click: () => void): void {
    const doc = this.view.containerEl.doc;
    const dot = down.currentTarget instanceof Element ? down.currentTarget.getBoundingClientRect() : null;
    const origin = { x: dot ? dot.left + dot.width / 2 : down.clientX, y: dot ? dot.top + dot.height / 2 : down.clientY };
    let svg: SVGSVGElement | null = null;
    let line: SVGLineElement | null = null;
    let over: { id: string; el: Element } | null = null;
    const leave = (): void => {
      over?.el.removeClass(DROP_TARGET_CLASS);
      over = null;
    };
    const finish = (): void => {
      stop();
      leave();
      svg?.remove();
    };
    const stop = trackPointer(doc, down.pointerId, {
      move: (move) => {
        if (!svg) {
          if (Math.hypot(move.clientX - down.clientX, move.clientY - down.clientY) <= CLICK_SLOP_PX) return;
          svg = doc.body.createSvg('svg', { cls: 'ffc-connector' });
          line = svg.createSvg('line', { attr: { x1: String(origin.x), y1: String(origin.y) } });
        }
        line?.setAttribute('x2', String(move.clientX));
        line?.setAttribute('y2', String(move.clientY));
        const node = doc.elementFromPoint(move.clientX, move.clientY)?.closest('.pele-node');
        const id = node?.getAttribute('data-id');
        const next = node && id && id !== from && node.closest(CARD) ? { id, el: node } : null;
        if (next?.el !== over?.el) {
          leave();
          over = next;
          over?.el.addClass(DROP_TARGET_CLASS);
        }
      },
      up: () => {
        const target = over;
        const dragged = !!svg;
        finish();
        if (!dragged) {
          click();
          return;
        }
        if (!target) return;
        this.change((now) => (way === 'out' ? addEdge(now.flow, from, target.id) : addEdge(now.flow, target.id, from)));
      },
      cancel: finish,
    });
  }

  private remove(): void {
    const live = this.current();
    if (!live || this.canvas.readonly) return;
    const { pick } = live;
    const index = pick.kind === 'edge' ? live.flow.edges.findIndex((e) => e.domId === pick.domId) : -1;
    // An edge that has just been drawn again under another id has nothing to remove, and no step to undo.
    if (pick.kind === 'edge' && index < 0) return;
    const source = pick.kind === 'node' ? removeNode(live.flow, pick.id) : removeEdge(live.flow, index);
    this.active = null;
    this.write(live.node, source);
  }

  // ── Naming ─────────────────────────────────────────────────────────────────

  /** A field over the picked node's text (or an edge's label), to type in. Enter saves it and Escape drops it. */
  private rename(): void {
    const live = this.current();
    if (!live) return;
    const host = diagramHost(live.node);
    const { pick } = live;
    const el = pick.kind === 'node' ? this.nodeEl(live.node, pick.id) : this.edgeEl(live.node, pick.domId);
    if (!host || !el) return;
    this.closeField();
    this.tools.clear();
    const index = pick.kind === 'edge' ? live.flow.edges.findIndex((e) => e.domId === pick.domId) : -1;
    const initial = pick.kind === 'node' ? labelOf(live.flow, pick.id) : edgeLabelOf(live.flow.edges[index]);
    this.field = openInPlaceField(host, el, initial, (text, commit) => {
      this.field = null;
      const now = this.current();
      if (!commit || !now || text.trim() === initial.trim()) {
        this.paint();
        return;
      }
      this.change((c) => (pick.kind === 'node' ? renameNode(c.flow, pick.id, text) : setEdgeLabel(c.flow, c.flow.edges.findIndex((e) => e.domId === pick.domId), text)));
    }, FLOW_FORMATS);
  }

  /** Turn a format on or off for the node's text. A wikilink is turned on by picking the note it goes to. */
  private applyFormat(format: TextFormat): void {
    const live = this.current();
    if (!live || live.pick.kind !== 'node') return;
    const { id } = live.pick;
    const text = labelOf(live.flow, id);
    if (format.id === 'wikilink' && !isOn(text, format)) {
      this.linkNote(live, id);
      return;
    }
    this.change((now) => renameNode(now.flow, id, toggleFormat(text, 0, text.length, format).value));
  }

  /** Make the node's text a link to a note: the text becomes the link's alias when it isn't the note's name. */
  private applyNoteLink(id: string, file: TFile, effect: SideEffect | null): void {
    this.change((now) => {
      return renameNode(now.flow, id, this.noteLinkText(file, plainText(labelOf(now.flow, id))));
    }, { effect });
  }

  private linkNote(live: Live, id: string): void {
    new LinkPicker(this.view.app, this.view.file?.path ?? '', plainText(labelOf(live.flow, id)), (file) => this.applyNoteLink(id, file, null)).open();
  }

  /** Make a note of one of the plugin's types from the node's text, and link the node to it. */
  private createNote(source: TypeSource): void {
    const live = this.current();
    if (!live || live.pick.kind !== 'node') return;
    const { id } = live.pick;
    createNoteFromText(this.plugin, this.canvas, plainText(labelOf(live.flow, id)), source, (file, effect) => this.applyNoteLink(id, file, effect));
  }

  /** Create an issue titled with the node's text, and link the node to it. */
  private createIssue(provider: ProviderId): void {
    const live = this.current();
    if (!live || live.pick.kind !== 'node') return;
    const { id } = live.pick;
    createIssueFromText(this.plugin, provider, this.canvas, live.node, plainText(labelOf(live.flow, id)), (issue) => {
      const name = `${issue.identifier} ${issue.title}`.replace(/[|[\]"]/g, ' ').replace(/\s+/g, ' ').trim();
      this.change((now) => renameNode(now.flow, id, `[[${name}]]`), { links: { ...(readDiagram(live.node)?.links ?? {}), [name]: issue.url } });
    });
  }

  // ── Menus ──────────────────────────────────────────────────────────────────

  /** Right-click on a node or an edge: pick it, and offer what can be done to it. */
  private onContextMenu(e: MouseEvent): void {
    const hit = this.hit(e.target);
    if (!hit || this.canvas.readonly) return;
    // Past core's own menu for the card.
    e.preventDefault();
    e.stopPropagation();
    this.closeField();
    if (!this.canvas.selection?.has(hit.node) || this.canvas.selection.size > 1) this.canvas.selectOnly?.(hit.node);
    this.active = hit;
    this.paint();
    const live = this.current();
    if (!live) return;
    // What the toolbar's buttons open, so the menu doesn't repeat them.
    const press = (label: string): void => this.tools.bar?.querySelector<HTMLElement>(`[aria-label="${label}"]`)?.click();
    const menu = new Menu();
    const item = (section: string, title: string, icon: string, run: () => void, checked?: boolean): void => {
      menu.addItem((i) => {
        i.setSection(section).setTitle(title).setIcon(icon).onClick(run);
        if (checked !== undefined) i.setChecked(checked);
      });
    };
    if (live.pick.kind === 'node') {
      const { id } = live.pick;
      item('add', 'Add node after', 'arrow-right-to-line', () => this.addFrom('after'));
      item('add', 'Add node before', 'arrow-left-to-line', () => this.addFrom('before'));
      item('add', 'Add branch', 'git-branch', () => this.addFrom('branch'));
      item('edit', 'Rename', 'pencil', () => this.rename());
      item('edit', 'Color…', 'palette', () => press('Color'));
      item('edit', 'Shape…', 'shapes', () => press('Shape'));
      const text = labelOf(live.flow, id);
      for (const format of FLOW_FORMATS) item('format', format.label, format.icon, () => this.applyFormat(format), isOn(text, format));
      if (this.plugin.hasNoteTypes) item('create', 'Convert to…', 'file-plus', () => this.createNote('notes'));
      if (this.plugin.hasDiscourseGraphs) item('create', 'Convert to discourse node…', 'file-plus', () => this.createNote('discourse'));
      if (this.plugin.hasIssues('linear')) item('create', 'Create Linear issue', 'square-arrow-out-up-right', () => this.createIssue('linear'));
      if (this.plugin.hasIssues('taskapp')) item('create', 'Create Task App issue', 'square-arrow-out-up-right', () => this.createIssue('taskapp'));
    } else {
      const { domId } = live.pick;
      const style = edgeStyleOf(live.flow.edges.find((edge) => edge.domId === domId) ?? live.flow.edges[0]);
      item('edit', 'Edit label', 'pencil', () => this.rename());
      for (const [id, label, icon] of EDGE_STYLES) {
        item('style', label, icon, () => this.change((now) => {
          const index = now.flow.edges.findIndex((edge) => edge.domId === domId);
          return index >= 0 ? setEdgeStyle(now.flow, index, id) : null;
        }), id === style);
      }
    }
    addExportItems(menu, this.plugin, this.canvas, live.node);
    menu.addItem((i) => i.setSection('danger').setTitle('Delete').setIcon('trash-2').setWarning(true).onClick(() => this.remove()));
    menu.showAtMouseEvent(e);
  }

  /** Items for the right-click menu of a flowchart card itself: which way it runs, and a first node for an empty one. */
  cardMenuItems(menu: Menu, node: CanvasNodeLike): void {
    const diagram = readDiagram(node);
    const flow = diagram && readFlowchart(diagram.source);
    if (!flow || this.canvas.readonly) return;
    if (nodeIds(flow).length === 0) {
      menu.addItem((i) => i.setSection('add').setTitle('Add node').setIcon('plus').onClick(() => this.write(node, addFirstNode(flow).source)));
    }
    for (const [direction, label] of DIRECTIONS) {
      menu.addItem((i) => i.setSection('direction').setTitle(label).setIcon('move-right').setChecked(flow.direction === direction || (direction === 'TD' && flow.direction === 'TB'))
        .onClick(() => this.write(node, setDirection(flow, direction))));
    }
  }
}

