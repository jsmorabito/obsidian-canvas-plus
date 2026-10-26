import { App, FuzzyMatch, FuzzySuggestModal, getIconIds, renderResults, setIcon } from 'obsidian';

/** The "no icon" choice. It is not an icon id, so it can't be mistaken for one. */
const NONE = '';
const PREFIX = 'lucide-';

/**
 * Pick an icon from Obsidian's whole Lucide set by searching its name, as Commander does: a list with each
 * icon drawn beside its name. `current` is the icon the node has now, which makes "No icon" a choice.
 */
export class IconPicker extends FuzzySuggestModal<string> {
  constructor(app: App, private current: string | null, private onPick: (name: string | null) => void) {
    super(app);
    this.setPlaceholder('Search icons…');
    this.setInstructions([
      { command: '↑↓', purpose: 'navigate' },
      { command: '↵', purpose: 'use icon' },
      { command: 'esc', purpose: 'dismiss' },
    ]);
  }

  getItems(): string[] {
    const ids = getIconIds().filter((id) => id.startsWith(PREFIX));
    return this.current ? [NONE, ...ids] : ids;
  }

  getItemText(id: string): string {
    return id === NONE ? 'No icon' : id.slice(PREFIX.length);
  }

  renderSuggestion(match: FuzzyMatch<string>, el: HTMLElement): void {
    const id = match.item;
    el.addClass('mod-complex');
    const content = el.createDiv({ cls: 'suggestion-content' });
    renderResults(content.createDiv({ cls: 'suggestion-title' }), this.getItemText(id), match.match);
    const flair = el.createDiv({ cls: 'suggestion-aux' }).createSpan({ cls: 'suggestion-flair' });
    setIcon(flair, id === NONE ? 'x' : id);
    if (id === this.current) el.addClass('is-selected');
  }

  onChooseItem(id: string): void {
    this.onPick(id === NONE ? null : id);
  }
}
