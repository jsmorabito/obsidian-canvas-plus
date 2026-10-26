import { titleFromText } from './note-name.ts';
import { App, Notice, SuggestModal, TFile, normalizePath, prepareFuzzySearch, renderResults, setIcon } from 'obsidian';

type Item = { kind: 'note'; file: TFile; title: string } | { kind: 'create'; name: string };

/**
 * Pick the note a mindmap node links to, as Obsidian's "Link to file" does: the vault's notes, searched by path.
 * It opens with `initial` (the node's text) searched, and when no note has exactly that name, the first choice
 * creates it, so Enter is enough.
 */
export class LinkPicker extends SuggestModal<Item> {
  constructor(app: App, private sourcePath: string, private initial: string, private onPick: (file: TFile) => void) {
    super(app);
    this.setPlaceholder('Link to a note…');
    this.setInstructions([
      { command: '↑↓', purpose: 'navigate' },
      { command: '↵', purpose: 'link to note' },
      { command: 'esc', purpose: 'dismiss' },
    ]);
  }

  onOpen(): void {
    void super.onOpen();
    this.inputEl.value = this.initial;
    this.inputEl.select();
    // The list was drawn for an empty search; ask for it again.
    this.inputEl.dispatchEvent(new Event('input'));
  }

  /** The path without its extension, as the quick switcher shows a note. */
  private titleOf(file: TFile): string {
    return file.path.replace(/\.md$/, '');
  }

  getSuggestions(query: string): Item[] {
    const q = query.trim();
    const files = this.app.vault.getMarkdownFiles();
    if (!q) {
      return [...files].sort((a, b) => b.stat.mtime - a.stat.mtime).map((file): Item => ({ kind: 'note', file, title: this.titleOf(file) }));
    }
    const match = prepareFuzzySearch(q);
    const found: Array<{ item: Item; score: number }> = [];
    for (const file of files) {
      const title = this.titleOf(file);
      const hit = match(title);
      if (hit) found.push({ item: { kind: 'note', file, title }, score: hit.score });
    }
    const items = found.sort((a, b) => b.score - a.score).map((f) => f.item);
    const exact = this.app.metadataCache.getFirstLinkpathDest(q, this.sourcePath);
    if (exact && exact.extension === 'md') {
      // The note by that name comes first.
      return [{ kind: 'note', file: exact, title: this.titleOf(exact) }, ...items.filter((i) => i.kind !== 'note' || i.file !== exact)];
    }
    const name = titleFromText(q);
    // Keep room for the create row: SuggestModal drops whatever is past `limit`.
    return name ? [{ kind: 'create', name }, ...items.slice(0, Math.max(0, this.limit - 1))] : items;
  }

  renderSuggestion(item: Item, el: HTMLElement): void {
    el.addClass('mod-complex');
    const content = el.createDiv({ cls: 'suggestion-content' });
    if (item.kind === 'create') {
      content.createDiv({ cls: 'suggestion-title', text: `Create “${item.name}”` });
      setIcon(el.createDiv({ cls: 'suggestion-aux' }).createSpan({ cls: 'suggestion-flair' }), 'plus');
      return;
    }
    const query = this.inputEl.value.trim();
    const hit = query ? prepareFuzzySearch(query)(item.title) : null;
    const title = content.createDiv({ cls: 'suggestion-title' });
    if (hit) renderResults(title, item.title, hit);
    else title.setText(item.title);
  }

  onChooseSuggestion(item: Item): void {
    if (item.kind === 'note') {
      this.onPick(item.file);
      return;
    }
    void this.create(item.name);
  }

  /** A new, empty note, where Obsidian puts new notes made from this one. */
  private async create(name: string): Promise<void> {
    try {
      const folder = this.app.fileManager.getNewFileParent(this.sourcePath);
      const path = normalizePath(`${folder.path}/${name}.md`);
      const existing = this.app.vault.getFileByPath(path);
      this.onPick(existing ?? await this.app.vault.create(path, ''));
    } catch {
      new Notice(`Couldn’t create the note “${name}”.`);
    }
  }
}
