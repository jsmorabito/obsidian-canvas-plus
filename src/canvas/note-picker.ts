import { Notice, SuggestModal, TFile, prepareFuzzySearch } from 'obsidian';
import type { CanvasPlusPlugin } from '../main.ts';
import type { NoteType } from '../note-types.ts';
import {
  CanvasLike, CanvasNodeLike, canvasFilePath, createFileNode, focusNode, viewportCenter,
} from './adapter.ts';
import { SIZE_NOTE_CARD } from './constants.ts';
import { findFreeSpot } from './free-spot.ts';
import { createdNoteEffect } from './created-note.ts';
import { fitNodeToCard, noteOfNode } from './note-card.ts';
import { SideEffect, batchWithEffect } from './undo-journal.ts';

type Item =
  | { kind: 'note'; file: TFile; type: NoteType }
  | { kind: 'create'; type: NoteType; title: string }
  | { kind: 'create-any'; title: string; open: (title: string) => Promise<TFile | null> };

/**
 * Add a typed note to the canvas. Lists only notes that belong to a note type.
 * When no note is named exactly the query, offers "Create note…", which opens
 * Note Types' new-note modal (type, fields, description) prefilled with the
 * query and adds the created note's card. Older Note Types builds without that
 * modal get "New <Type>: <query>" rows instead, and only when nothing matches.
 * A note already on the canvas is selected and zoomed to instead of being added twice.
 */
export class NotePicker extends SuggestModal<Item> {
  constructor(
    private plugin: CanvasPlusPlugin,
    private canvas: CanvasLike,
    /** Drop point (canvas coordinates, card centred on it). Omit to find a free spot near the view centre. */
    private at: { x: number; y: number } | null = null,
  ) {
    super(plugin.app);
    this.setPlaceholder('Add a note to the canvas…');
    this.setInstructions([
      { command: '↑↓', purpose: 'navigate' },
      { command: '↵', purpose: 'add to canvas' },
      { command: 'esc', purpose: 'dismiss' },
    ]);
  }

  private typedNotes(): Array<{ file: TFile; type: NoteType }> {
    const seen = new Set<string>();
    const out: Array<{ file: TFile; type: NoteType }> = [];
    for (const type of this.plugin.types.getNoteTypes()) {
      for (const file of this.plugin.types.getNoteTypeFiles(type)) {
        if (seen.has(file.path)) continue;
        seen.add(file.path);
        out.push({ file, type });
      }
    }
    return out;
  }

  getSuggestions(query: string): Item[] {
    const q = query.trim();
    const notes = this.typedNotes();
    if (!q) {
      return notes
        .sort((a, b) => a.file.basename.localeCompare(b.file.basename))
        .map((n): Item => ({ kind: 'note', ...n }));
    }
    const match = prepareFuzzySearch(q);
    const scored: Array<{ item: Item; score: number }> = [];
    for (const n of notes) {
      const fm = this.app.metadataCache.getFileCache(n.file)?.frontmatter;
      const title = typeof fm?.title === 'string' ? fm.title : '';
      const hit = match(`${n.file.basename} ${title}`);
      if (hit) scored.push({ item: { kind: 'note', ...n }, score: hit.score });
    }
    const found = scored.sort((a, b) => b.score - a.score).map((s) => s.item);
    const api = this.plugin.types;
    if (api.openNewNoteModal && api.getNoteTypes().length > 0) {
      if (this.noteExists(q, notes)) return found;
      // Keep room for the create row: SuggestModal drops whatever is past `limit`.
      const create: Item = { kind: 'create-any', title: q, open: (title) => api.openNewNoteModal?.(title) ?? Promise.resolve(null) };
      return [...found.slice(0, Math.max(0, this.limit - 1)), create];
    }
    if (found.length > 0) return found;
    return this.plugin.types.getNoteTypes().map((type): Item => ({ kind: 'create', type, title: q }));
  }

  /** Whether a note named `query` already exists: any note by that name, or a typed note with that frontmatter title. */
  private noteExists(query: string, notes: Array<{ file: TFile }>): boolean {
    if (this.app.metadataCache.getFirstLinkpathDest(query, '')) return true;
    const lower = query.toLowerCase();
    return notes.some((n) => {
      const title: unknown = this.app.metadataCache.getFileCache(n.file)?.frontmatter?.title;
      return typeof title === 'string' && title.toLowerCase() === lower;
    });
  }

  renderSuggestion(item: Item, el: HTMLElement): void {
    el.addClass('ffc-picker-row');
    if (item.kind === 'create-any') {
      el.createSpan({ text: `Create note "${item.title}"…`, cls: 'suggestion-title' });
      return;
    }
    if (item.kind === 'create') {
      el.createSpan({ text: `New ${item.type.name}: ${item.title}`, cls: 'suggestion-title' });
      return;
    }
    el.createSpan({ text: item.file.basename, cls: 'suggestion-title' });
    el.createSpan({ text: item.type.name, cls: 'ffc-note-chip' });
  }

  onChooseSuggestion(item: Item): void {
    if (item.kind === 'note') {
      this.addOrFocus(item.file);
      return;
    }
    const created = item.kind === 'create-any'
      ? item.open(item.title)
      : this.plugin.types.createNote(item.type, item.title);
    void created.then(async (file) => {
      if (!file) return;
      // What the note holds right now, so undoing the card can take the note away only if nobody has touched it.
      const baseline = await this.app.vault.read(file);
      this.addOrFocus(file, createdNoteEffect(this.plugin, this.canvas, file, baseline, canvasFilePath(this.app, this.canvas)));
    });
  }

  private addOrFocus(file: TFile, effect: SideEffect | null = null): void {
    const existing = [...(this.canvas.nodes?.values() ?? [])].find((n: CanvasNodeLike) => noteOfNode(n)?.path === file.path);
    if (existing) {
      focusNode(this.canvas, existing);
      return;
    }
    try {
      const size = SIZE_NOTE_CARD;
      const pos = this.at
        ? { x: Math.round(this.at.x - size.width / 2), y: Math.round(this.at.y - size.height / 2) }
        : findFreeSpot(this.canvas, viewportCenter(this.canvas), size);
      const node = batchWithEffect(this.canvas, effect, () => createFileNode(this.canvas, { pos, size, file }));
      if (!node) return;
      fitNodeToCard(this.plugin, this.canvas, node);
      if (this.at) {
        this.canvas.deselectAll?.();
        this.canvas.selectOnly?.(node);
      } else {
        focusNode(this.canvas, node);
      }
    } catch (err) {
      new Notice(`Could not add note to canvas: ${(err as Error).message}`);
    }
  }
}
