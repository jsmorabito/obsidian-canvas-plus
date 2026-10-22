import { setIcon } from 'obsidian';
import { isElement, isNode, shieldFromCanvas } from './adapter.ts';

export interface ActionEntry {
  section: string;
  label: string;
  icon: string;
  /** The shortcut that does the same, shown at the right. */
  hint?: string;
  /** Extra words that find it. */
  keywords?: string;
  run: () => void;
}

/**
 * The actions panel: a searchable list of things to do, opening just above the bottom toolbar from its Actions
 * button. Arrow keys move, Enter runs, Escape (or a press outside) closes it. What it lists is asked for each time
 * it opens, since it depends on the selection and on what is turned on.
 */
export class ActionsPanel {
  private el: HTMLElement;
  private input: HTMLInputElement;
  private list: HTMLElement;
  private entries: ActionEntry[] = [];
  private shown: ActionEntry[] = [];
  private rows: HTMLElement[] = [];
  private index = 0;
  private stopOutside: (() => void) | null = null;

  constructor(menuEl: HTMLElement, private anchor: HTMLElement, private getEntries: () => ActionEntry[]) {
    // Core's own prompt markup (the quick switcher's), so themes and snippets style it like any other.
    this.el = menuEl.createDiv({ cls: 'ffc-actions prompt' });
    const search = this.el.createDiv({ cls: 'prompt-input-container' });
    this.input = search.createEl('input', {
      cls: 'prompt-input',
      attr: { type: 'text', placeholder: 'Search actions', spellcheck: 'false', enterkeyhint: 'done' },
    });
    this.list = this.el.createDiv({ cls: 'prompt-results' });
    shieldFromCanvas(this.el);
    this.input.addEventListener('input', () => { this.index = 0; this.render(); });
    this.input.addEventListener('keydown', (e) => this.onKey(e));
  }

  get open(): boolean {
    return this.el.hasClass('is-shown');
  }

  toggle(): void {
    if (this.open) this.hide();
    else this.show();
  }

  show(): void {
    this.entries = this.getEntries();
    this.input.value = '';
    this.index = 0;
    this.render();
    this.el.addClass('is-shown');
    this.anchor.addClass('is-active');
    this.input.focus();
    // A press anywhere else closes it. The button itself toggles, so it is left to do that.
    const doc = this.el.doc;
    const onDown = (e: PointerEvent): void => {
      if (!isNode(e.target) || this.el.contains(e.target) || this.anchor.contains(e.target)) return;
      this.hide();
    };
    doc.addEventListener('pointerdown', onDown, true);
    this.stopOutside = () => doc.removeEventListener('pointerdown', onDown, true);
  }

  hide(): void {
    this.stopOutside?.();
    this.stopOutside = null;
    this.el.removeClass('is-shown');
    this.anchor.removeClass('is-active');
    // Focus back on the canvas, so its keys work again.
    if (isElement(this.el.doc.activeElement) && this.el.contains(this.el.doc.activeElement)) this.input.blur();
  }

  destroy(): void {
    this.hide();
    this.el.remove();
  }

  private matches(entry: ActionEntry, words: string[]): boolean {
    const text = `${entry.label} ${entry.section} ${entry.keywords ?? ''}`.toLowerCase();
    return words.every((w) => text.includes(w));
  }

  private render(): void {
    const words = this.input.value.toLowerCase().split(/\s+/).filter(Boolean);
    this.shown = this.entries.filter((e) => this.matches(e, words));
    this.index = Math.min(this.index, Math.max(0, this.shown.length - 1));
    this.list.empty();
    this.rows = [];
    if (this.shown.length === 0) {
      this.list.createDiv({ cls: 'prompt-empty', text: 'No actions found' });
      return;
    }
    let section = '';
    this.shown.forEach((entry, i) => {
      if (entry.section !== section) {
        section = entry.section;
        this.list.createDiv({ cls: 'suggestion-item mod-group' }).createDiv({ cls: 'suggestion-content' })
          .createDiv({ cls: 'suggestion-title', text: section });
      }
      const row = this.list.createDiv({ cls: 'suggestion-item mod-complex' });
      setIcon(row.createDiv({ cls: 'suggestion-icon' }).createSpan({ cls: 'suggestion-flair' }), entry.icon);
      row.createDiv({ cls: 'suggestion-content' }).createDiv({ cls: 'suggestion-title', text: entry.label });
      if (entry.hint) row.createDiv({ cls: 'suggestion-aux' }).createSpan({ cls: 'suggestion-hotkey', text: entry.hint });
      row.addEventListener('mouseenter', () => this.select(i, false));
      row.addEventListener('click', () => this.run(entry));
      this.rows.push(row);
    });
    this.select(this.index, false);
  }

  private select(i: number, scroll: boolean): void {
    this.index = i;
    this.rows.forEach((row, n) => row.toggleClass('is-selected', n === i));
    if (scroll) this.rows[i]?.scrollIntoView({ block: 'nearest' });
  }

  private run(entry: ActionEntry): void {
    this.hide();
    entry.run();
  }

  private onKey(e: KeyboardEvent): void {
    if (e.isComposing) return;
    const last = this.shown.length - 1;
    if (e.key === 'Escape' || ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k')) {
      // Cmd or Ctrl+K opens the panel from the canvas, so it closes it from here too.
      this.hide();
    } else if (e.key === 'ArrowDown') {
      this.select(this.index >= last ? 0 : this.index + 1, true);
    } else if (e.key === 'ArrowUp') {
      this.select(this.index <= 0 ? last : this.index - 1, true);
    } else if (e.key === 'Enter') {
      const entry = this.shown[this.index];
      if (entry) this.run(entry);
    } else {
      // Typing in the search box is left alone, but the canvas's own keys mustn't see it.
      e.stopPropagation();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
  }
}
