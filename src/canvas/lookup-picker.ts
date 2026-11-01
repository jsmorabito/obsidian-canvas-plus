import type { CanvasPlusPlugin } from '../main.ts';
import { CanvasLike, CanvasNodeLike } from './adapter.ts';
import { ItemPicker } from './item-picker.ts';

/** What differs between the items a service lets the canvas look up: how to ask for them, draw them and put them on the canvas. */
export interface Lookup<T extends { id: string }> {
  /** Singular: `project` or `initiative`. */
  noun: string;
  placeholder: string;
  /** The id in a pasted link, or null when the text is not one. */
  parse(text: string): string | null;
  byRef(ref: string): Promise<T | null>;
  search(term: string): Promise<T[]>;
  recent(): Promise<T[]>;
  existing(canvas: CanvasLike, item: T): CanvasNodeLike | undefined;
  add(canvas: CanvasLike, item: T, at: { x: number; y: number } | null): CanvasNodeLike | undefined;
  /** Draws the status marker in a suggestion. */
  mark(parent: HTMLElement, item: T): void;
  title(item: T): string;
}

/**
 * Search by words, or give an item's URL. With nothing typed it lists what was updated most recently. An item already
 * on the canvas is selected and zoomed to instead of being added twice.
 */
export class LookupPicker<T extends { id: string }> extends ItemPicker<T> {
  constructor(
    plugin: CanvasPlusPlugin,
    canvas: CanvasLike,
    at: { x: number; y: number } | null,
    onAdded: () => void,
    private lookup: Lookup<T>,
  ) {
    super(plugin, canvas, at, onAdded, lookup.placeholder);
  }

  protected noun(): string { return this.lookup.noun; }

  protected async find(q: string): Promise<T[]> {
    const ref = this.lookup.parse(q);
    const exact = ref ? await this.lookup.byRef(ref) : null;
    return exact ? [exact] : q ? await this.lookup.search(q) : await this.lookup.recent();
  }

  protected existing(item: T): CanvasNodeLike | undefined { return this.lookup.existing(this.canvas, item); }

  protected add(item: T, at: { x: number; y: number } | null): CanvasNodeLike | undefined { return this.lookup.add(this.canvas, item, at); }

  renderSuggestion(item: T, el: HTMLElement): void {
    el.addClass('ffc-picker-row');
    const main = el.createDiv({ cls: 'ffc-issue-suggestion' });
    this.lookup.mark(main, item);
    main.createSpan({ cls: 'suggestion-title', text: this.lookup.title(item) });
  }
}
