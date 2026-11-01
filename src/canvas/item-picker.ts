import { Notice, SuggestModal } from 'obsidian';
import type { CanvasPlusPlugin } from '../main.ts';
import { CanvasLike, CanvasNodeLike, focusNode } from './adapter.ts';

/** How long typing pauses before the service is asked, so a request isn't made for every key. */
const TYPING_PAUSE_MS = 250;

/**
 * The picker behind adding an issue or a project to the canvas: what is shown follows what is typed, a stale answer
 * never replaces a newer one, and choosing an item that is already on the canvas zooms to it instead of adding it twice.
 * A subclass says how to find, draw, look up and add its items.
 */
export abstract class ItemPicker<T extends { id: string }> extends SuggestModal<T> {
  private seq = 0;
  private last: T[] = [];

  constructor(
    protected plugin: CanvasPlusPlugin,
    protected canvas: CanvasLike,
    /** Drop point (canvas coordinates, card centred on it). Omit to find a free spot near the view centre. */
    private at: { x: number; y: number } | null,
    /** Called once the card is on the canvas, to dress it. */
    private onAdded: () => void,
    placeholder: string,
  ) {
    super(plugin.app);
    this.setPlaceholder(placeholder);
    this.setInstructions([
      { command: '↑↓', purpose: 'navigate' },
      { command: '↵', purpose: 'add to canvas' },
      { command: 'esc', purpose: 'dismiss' },
    ]);
  }

  /** What the picker adds, singular: `issue` or `project`. A method, since fields don't exist yet while the base is built. */
  protected abstract noun(): string;
  /** What matches the typed text: an exact link or identifier, a search, or what changed lately for nothing typed. */
  protected abstract find(query: string): Promise<T[]>;
  /** The node already showing the item, if any. */
  protected abstract existing(item: T): CanvasNodeLike | undefined;
  /** Add a card for the item. `at` is where its centre goes, or null for the nearest free spot. */
  protected abstract add(item: T, at: { x: number; y: number } | null): CanvasNodeLike | undefined;

  async getSuggestions(query: string): Promise<T[]> {
    const mine = ++this.seq;
    const q = query.trim();
    if (q) await new Promise((resolve) => window.setTimeout(resolve, TYPING_PAUSE_MS));
    // Typed on since: the newer call will answer, so leave what is shown alone.
    if (mine !== this.seq) return this.last;
    try {
      const found = await this.find(q);
      if (mine !== this.seq) return this.last;
      this.emptyStateText = `No ${this.noun()}s found.`;
      this.last = found;
      return found;
    } catch (err) {
      if (mine === this.seq) {
        this.emptyStateText = (err as Error).message;
        this.last = [];
      }
      return [];
    }
  }

  onChooseSuggestion(item: T): void {
    const existing = this.existing(item);
    if (existing) {
      focusNode(this.canvas, existing);
      return;
    }
    try {
      const node = this.add(item, this.at);
      if (!node) return;
      this.onAdded();
      if (this.at) {
        this.canvas.deselectAll?.();
        this.canvas.selectOnly?.(node);
      } else {
        focusNode(this.canvas, node);
      }
    } catch (err) {
      new Notice(`Could not add ${this.noun()} to canvas: ${(err as Error).message}`);
    }
  }
}
