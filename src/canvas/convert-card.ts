import { Notice, SuggestModal, TFile } from 'obsidian';
import type { CanvasPlusPlugin } from '../main.ts';
import type { NoteType } from '../note-types.ts';
import {
  CanvasEdgeLike, CanvasLike, CanvasNodeLike, canvasFilePath, createFileNode, nodeBox, putEdge, removeNode, selectedNodes,
} from './adapter.ts';
import { SIZE_NOTE_CARD } from './constants.ts';
import { createdNoteEffect } from './created-note.ts';
import { draftFrom, isConvertibleCard } from './issue-create.ts';
import { button } from './issue-menu.ts';
import { NOTE_TYPES_ICON } from './icons.ts';
import { fitNodeToCard } from './note-card.ts';
import { SideEffect, batchWithEffect } from './undo-journal.ts';

/** Characters a file name can't hold. */
const UNSAFE_NAME = /[\\/:*?"<>|#^[\]]/g;
/** Well under the file system's limit, which counts the folder and extension too. */
const MAX_NAME = 100;
/** Markup that `firstLine` strips from a title. */
const MARKUP = /[[\]*_`~]/;

/** The note's title and description for a card: the first line, then the rest, keeping the first line's own markup. */
function noteDraft(node: CanvasNodeLike): { title: string; description: string } | null {
  const text = ((node.getData?.().text as string | undefined) ?? '').trim();
  const { title: line, description } = draftFrom(node);
  const title = line.replace(UNSAFE_NAME, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME).trim();
  if (!title) return null;
  const first = text.split('\n')[0];
  // Keep the whole text when the title lost something: markup, or the end of a long line.
  return { title, description: MARKUP.test(first) || line.length > title.length ? text : description };
}

class TypePicker extends SuggestModal<NoteType> {
  constructor(private plugin: CanvasPlusPlugin, private onPick: (type: NoteType) => void) {
    super(plugin.app);
    this.setPlaceholder('Convert to…');
  }

  getSuggestions(query: string): NoteType[] {
    const q = query.trim().toLowerCase();
    return this.plugin.types.getNoteTypes().filter((t) => t.name.toLowerCase().includes(q));
  }

  renderSuggestion(type: NoteType, el: HTMLElement): void {
    el.createSpan({ text: type.name, cls: 'suggestion-title' });
  }

  onChooseSuggestion(type: NoteType): void {
    this.onPick(type);
  }
}

/** One undo/redo pair that runs each of `effects` in turn. */
function combined(effects: SideEffect[]): SideEffect {
  return {
    undo: async () => { for (const e of [...effects].reverse()) await e.undo(); },
    redo: async () => { for (const e of effects) await e.redo(); },
    files: effects.flatMap((e) => e.files ?? []),
  };
}

/**
 * Make a note of `type` from each card's text, then swap the cards for the notes' cards in one undo step,
 * each in its card's place and with its arrows.
 */
async function convertCards(plugin: CanvasPlusPlugin, canvas: CanvasLike, nodes: CanvasNodeLike[], type: NoteType, onDone: () => void): Promise<void> {
  const made: Array<{ node: CanvasNodeLike; file: TFile }> = [];
  const effects: SideEffect[] = [];
  const canvasPath = canvasFilePath(plugin.app, canvas);
  let skipped = 0;
  try {
    for (const node of nodes) {
      const draft = noteDraft(node);
      const file = draft ? await plugin.types.createNote(type, draft.title, undefined, draft.description) : null;
      if (!file) { skipped++; continue; }
      // What the note holds right now, so undo can take it away only if nobody has touched it.
      const baseline = await plugin.app.vault.read(file);
      effects.push(createdNoteEffect(plugin, canvas, file, baseline, canvasPath));
      made.push({ node, file });
    }
  } catch (err) {
    new Notice(`Could not convert every card: ${(err as Error).message}`);
  }

  // A card removed while the notes were being made stays removed (its note is kept).
  const live = made.filter(({ node }) => node.id && canvas.nodes?.get(node.id) === node);
  if (live.length > 0) {
    batchWithEffect(canvas, combined(effects), () => {
      for (const { node, file } of live) {
        const box = nodeBox(node);
        if (!box) continue;
        // Removing a card removes its arrows, so take their data first and put them back on the new card.
        const arrows = [...(canvas.edges?.values() ?? [])]
          .filter((e: CanvasEdgeLike) => e.from.node === node || e.to.node === node)
          .map((e) => ({ data: e.getData(), from: e.from.node === node, to: e.to.node === node }));
        const card = createFileNode(canvas, { pos: { x: box.x, y: box.y }, size: SIZE_NOTE_CARD, file });
        if (!card?.id) continue;
        removeNode(canvas, node);
        for (const { data, from, to } of arrows) {
          putEdge(canvas, { ...data, ...(from ? { fromNode: card.id } : {}), ...(to ? { toNode: card.id } : {}) });
        }
        fitNodeToCard(plugin, canvas, card);
      }
    });
    new Notice(`Converted to ${type.name}: ${live.map((c) => c.file.basename).join(', ')}.`);
  }
  if (skipped > 0) new Notice(`${skipped} ${skipped === 1 ? 'card was' : 'cards were'} not converted: the note could not be created.`);
  onDone();
}

let picking = false;

/** Ask for a note type, then convert `nodes` to it. One picker at a time. */
export function convertWithPicker(plugin: CanvasPlusPlugin, canvas: CanvasLike, nodes: CanvasNodeLike[], onDone: () => void): void {
  const cards = nodes.filter(isConvertibleCard);
  if (picking || cards.length === 0) return;
  picking = true;
  const picker = new TypePicker(plugin, (type) => { void convertCards(plugin, canvas, cards, type, onDone); });
  const close = picker.onClose.bind(picker);
  picker.onClose = (): void => { close(); picking = false; };
  picker.open();
}

/** A "Convert to…" button in the selection menu: pick a note type, and the selected text cards become notes of it. */
export function injectConvertButton(plugin: CanvasPlusPlugin, canvas: CanvasLike, selected: CanvasNodeLike[], onDone: () => void): void {
  const menuEl = canvas.menu?.menuEl;
  if (!menuEl || selected.length === 0 || !plugin.hasNoteTypes || !selected.every(isConvertibleCard)) return;
  button(menuEl, 'ffc-convert-btn', 'Convert to…', NOTE_TYPES_ICON, () => {
    convertWithPicker(plugin, canvas, selectedNodes(canvas), onDone);
  });
}
