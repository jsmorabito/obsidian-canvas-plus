import { setIcon } from 'obsidian';
import type { CanvasPlusPlugin } from '../main.ts';
import { CanvasLike, CanvasNodeLike, CanvasViewLike, shieldFromCanvas } from './adapter.ts';
import { readIssueRef } from './issue-ref.ts';
import { isPinned, pinLook, pinnedSize, togglePins } from './pin-node.ts';
import { readWidget } from './widget-card.ts';

/** Custom properties core and this plugin set on a node for its colour and styling, which its content is drawn with. */
const KEPT_PROP = /^--(?!ffc-pin-)/;
/** What a copy of a node leaves out: the pin, core's handles and label, and the selection. */
const LEFT_OUT = '.ffc-node-pin, .canvas-node-connection-point, .canvas-node-resizer, .canvas-node-label';

/**
 * What a pinned node opens into when its pin is clicked: its content, in a panel in the top right where the note's
 * context panel is, above it. It is a copy of what the node shows, so it looks the same for every kind of node. It
 * goes away when anything else on the canvas is clicked, on Esc, or when the node is no longer a pin.
 */
export class PinViewer {
  private el: HTMLElement;
  private node: CanvasNodeLike | null = null;
  /** What the copy was made from, so it is made again when the node's content changes. */
  private shown = '';
  private cleanup: () => void;

  /** `parent` is the column the panel shares with the context panel. `onChange` runs after the panel changes the canvas. */
  constructor(private plugin: CanvasPlusPlugin, private view: CanvasViewLike, parent: HTMLElement, private onChange: () => void) {
    this.el = parent.createDiv({ cls: 'ffc-pin-viewer' });
    this.el.hide();
    shieldFromCanvas(this.el);
    const wrapper = view.canvas!.wrapperEl;
    // A press anywhere on the canvas puts the panel away. A click on a pin opens it afterwards.
    const away = (): void => { this.dismiss(); };
    wrapper.addEventListener('pointerdown', away, true);
    this.cleanup = () => wrapper.removeEventListener('pointerdown', away, true);
  }

  private get canvas(): CanvasLike { return this.view.canvas!; }

  open(node: CanvasNodeLike): void {
    this.node = node;
    this.render(node);
    this.el.show();
  }

  /** Put the panel away. Returns whether it was open. */
  dismiss(): boolean {
    if (!this.node) return false;
    this.node = null;
    this.el.hide();
    this.el.empty();
    return true;
  }

  /** Close the panel when its node has gone, or is shown in full. */
  sync(): void {
    const node = this.node;
    if (!node) return;
    if (!node.id || this.canvas.nodes?.get(node.id) !== node || !isPinned(node)) {
      this.dismiss();
      return;
    }
    if (this.signatureOf(node) !== this.shown) this.render(node);
  }

  private signatureOf(node: CanvasNodeLike): string {
    return `${node.nodeEl?.textContent?.length ?? 0}|${node.file?.stat.mtime ?? ''}|${node.text?.length ?? 0}`;
  }

  destroy(): void {
    this.cleanup();
    this.el.remove();
  }

  private render(node: CanvasNodeLike): void {
    this.shown = this.signatureOf(node);
    this.el.empty();
    const header = this.el.createDiv({ cls: 'ffc-pin-viewer-header' });
    const look = pinLook(this.plugin, node);
    const icon = header.createSpan({ cls: 'ffc-pin-viewer-icon' });
    icon.setCssProps({ '--ffc-pin-color': look.color });
    setIcon(icon, look.icon);
    header.createSpan({ cls: 'ffc-pin-viewer-title', text: this.titleOf(node) });
    this.action(header, 'map-pin-off', 'Show in full', () => {
      togglePins(this.canvas, [node]);
      this.dismiss();
      this.onChange();
    });
    this.action(header, 'x', 'Close', () => this.dismiss());

    const body = this.el.createDiv({ cls: 'ffc-pin-viewer-body' });
    const size = pinnedSize(node);
    // The node's own shape, so a tall note isn't squashed and a wide diagram isn't stretched.
    if (size) body.setCssProps({ '--ffc-pin-ratio': `${size.width} / ${size.height}` });
    const copy = this.copyOf(node);
    if (copy) body.appendChild(copy);
    else body.createDiv({ cls: 'ffc-pin-viewer-live', text: 'This is live content. Select Show in full to use it.' });
  }

  private action(parent: HTMLElement, icon: string, label: string, run: () => void): void {
    const button = parent.createDiv({ cls: 'clickable-icon ffc-pin-viewer-action', attr: { 'aria-label': label, 'data-tooltip-position': 'top' } });
    setIcon(button, icon);
    button.addEventListener('click', run);
  }

  private titleOf(node: CanvasNodeLike): string {
    const ref = readIssueRef(node);
    if (ref) return ref.title ? `${ref.identifier} ${ref.title}` : ref.identifier;
    if (node.file) return node.file.basename;
    const line = (node.text ?? '').split('\n').find((l) => l.trim() && !l.startsWith('<'));
    return line?.replace(/^[#>\-*\s]+/, '').trim() || 'Pin';
  }

  /**
   * A copy of the node as it is drawn, for the panel to hold. It keeps the node's classes and colour, which its content's
   * styles are written against, and loses its place on the canvas.
   */
  private copyOf(node: CanvasNodeLike): HTMLElement | null {
    const source = node.nodeEl;
    // A view or a page is a running thing: copying it would load it a second time, and the copy couldn't be used.
    if (!source || readWidget(node) || source.querySelector('iframe, webview')) return null;
    const copy = source.cloneNode(true) as HTMLElement;
    copy.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));
    copy.removeAttribute('data-ffc-pin');
    copy.removeClasses(['is-selected', 'is-focused']);
    copy.querySelectorAll(LEFT_OUT).forEach((el) => el.remove());
    const props: Array<[string, string]> = [];
    for (const name of Array.from(source.style)) if (KEPT_PROP.test(name)) props.push([name, source.style.getPropertyValue(name)]);
    copy.removeAttribute('style');
    for (const [name, value] of props) copy.style.setProperty(name, value);
    return copy;
  }
}
