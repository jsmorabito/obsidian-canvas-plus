import { EventRef, Notice, setIcon, setTooltip } from 'obsidian';
import type { CanvasPlusPlugin } from '../main.ts';
import { CanvasViewLike } from './adapter.ts';

/** On the window's body while a canvas fills it: hides the ribbons, sidebars, tab bars and status bar (see styles.css). */
const FOCUS_BODY_CLASS = 'ffc-canvas-focus';
/** On the view that fills the window, so everything around it can be hidden. */
const FOCUS_LEAF_CLASS = 'ffc-focus-leaf';

/** The canvas filling each window, keyed by that window's body. */
const owners = new WeakMap<HTMLElement, Focuser>();

/**
 * Focusing a canvas: a button in the view header that hides Obsidian's chrome around the canvas (the ribbons,
 * sidebars, tab bars, status bar and any other tabs beside it), leaving the canvas and its view header to fill
 * the window. Selecting it again (or Esc, with nothing selected) brings the chrome back. Not full screen: the
 * window stays as it is.
 */
export class Focuser {
  private actionEl: HTMLElement;
  /** The body of the window the canvas fills, kept so the chrome comes back there even if the canvas moves to another window. */
  private body: HTMLElement | null = null;
  private leafRef: EventRef;

  constructor(private plugin: CanvasPlusPlugin, private view: CanvasViewLike) {
    this.actionEl = view.addAction('maximize-2', 'Focus canvas', () => this.toggle());
    // Another leaf in this window becoming active (a sidebar view opened by a command, a note opened in a new
    // tab) would be hidden, so the chrome comes back for it. A leaf in one of this canvas's tab panels is still
    // on screen, and a leaf in another window isn't hidden at all.
    this.leafRef = plugin.app.workspace.on('active-leaf-change', (leaf) => {
      const el = leaf?.view.containerEl;
      if (this.body && el && el.doc.body === this.body && !this.view.containerEl.contains(el)) this.stop();
    });
    this.render();
  }

  get focused(): boolean {
    return this.body !== null;
  }

  toggle(): void {
    if (this.body) this.stop();
    else this.start();
  }

  start(): void {
    if (this.body) return;
    // Everything beside the main area is hidden, so a canvas in a sidebar would vanish with it.
    if (!this.view.containerEl.closest('.workspace-split.mod-root')) {
      new Notice('Move the canvas into the main area to focus it.');
      return;
    }
    const body = this.view.containerEl.doc.body;
    // Only one canvas fills a window at a time: this one takes over.
    owners.get(body)?.stop();
    this.body = body;
    owners.set(body, this);
    body.addClass(FOCUS_BODY_CLASS);
    this.view.containerEl.addClass(FOCUS_LEAF_CLASS);
    this.render();
  }

  stop(): void {
    const body = this.body;
    if (!body) return;
    this.body = null;
    if (owners.get(body) === this) owners.delete(body);
    body.removeClass(FOCUS_BODY_CLASS);
    this.view.containerEl.removeClass(FOCUS_LEAF_CLASS);
    this.render();
  }

  destroy(): void {
    this.stop();
    this.plugin.app.workspace.offref(this.leafRef);
    this.actionEl.remove();
  }

  /** The header button says what selecting it does. */
  private render(): void {
    setIcon(this.actionEl, this.body ? 'minimize-2' : 'maximize-2');
    setTooltip(this.actionEl, this.body ? 'Show Obsidian’s panels' : 'Focus canvas');
  }
}
