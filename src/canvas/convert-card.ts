import { Notice, SuggestModal, TFile } from 'obsidian';
import type { CanvasPlusPlugin } from '../main.ts';
import { createDgNode, dgNodeTypes } from '../discourse-graphs.ts';
import {
  CanvasEdgeLike, CanvasLike, CanvasNodeLike, canvasFilePath, createFileNode, nodeBox, putEdge, removeNode, selectedNodes,
} from './adapter.ts';
import { SIZE_NOTE_CARD } from './constants.ts';
import { createdNoteEffect } from './created-note.ts';
import { draftFrom, isConvertibleCard } from './issue-create.ts';
import { button } from './issue-menu.ts';
import { DG_NODE_ICON, NOTE_TYPES_ICON } from './icons.ts';
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

/** Something a card can become: a Note Types type or a Discourse Graphs node type. */
interface Target {
  name: string;
  /** Where the type comes from, shown beside its name when more than one plugin supplies types. */
  source: string;
  /** Make the note; `created` is false when a note by that name already existed and was used as it is. */
  make(title: string, description: string): Promise<{ file: TFile; created: boolean } | null>;
}

/** Which plugin's types a picker lists: both, or just one. */
export type TypeSource = 'all' | 'notes' | 'discourse';

function targetsOf(plugin: CanvasPlusPlugin, source: TypeSource): Target[] {
  const targets: Target[] = (source === 'discourse' ? [] : plugin.types.getNoteTypes()).map((type) => ({
    name: type.name,
    source: 'Note Types',
    make: async (title, description) => {
      const file = await plugin.types.createNote(type, title, undefined, description);
      return file ? { file, created: true } : null;
    },
  }));
  for (const type of source === 'notes' ? [] : dgNodeTypes(plugin.app)) {
    targets.push({ name: type.name, source: 'Discourse Graphs', make: (title, description) => createDgNode(plugin.app, type, title, description) });
  }
  return targets;
}

class TypePicker extends SuggestModal<Target> {
  private targets: Target[];

  constructor(plugin: CanvasPlusPlugin, source: TypeSource, private onPick: (target: Target) => void) {
    super(plugin.app);
    this.targets = targetsOf(plugin, source);
    this.setPlaceholder(source === 'discourse' ? 'Convert to discourse node…' : 'Convert to…');
  }

  getSuggestions(query: string): Target[] {
    const q = query.trim().toLowerCase();
    return this.targets.filter((t) => t.name.toLowerCase().includes(q) || t.source.toLowerCase().includes(q));
  }

  renderSuggestion(target: Target, el: HTMLElement): void {
    el.addClass('ffc-picker-row');
    el.createSpan({ text: target.name, cls: 'suggestion-title' });
    if (new Set(this.targets.map((t) => t.source)).size > 1) el.createSpan({ text: target.source, cls: 'ffc-note-chip' });
  }

  onChooseSuggestion(target: Target): void {
    this.onPick(target);
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
async function convertCards(plugin: CanvasPlusPlugin, canvas: CanvasLike, nodes: CanvasNodeLike[], type: Target, onDone: () => void): Promise<void> {
  const made: Array<{ node: CanvasNodeLike; file: TFile }> = [];
  const effects: SideEffect[] = [];
  const canvasPath = canvasFilePath(plugin.app, canvas);
  let skipped = 0;
  try {
    for (const node of nodes) {
      const draft = noteDraft(node);
      const result = draft ? await type.make(draft.title, draft.description) : null;
      if (!result) { skipped++; continue; }
      const { file } = result;
      if (result.created) {
        // What the note holds right now, so undo can take it away only if nobody has touched it.
        const baseline = await plugin.app.vault.read(file);
        effects.push(createdNoteEffect(plugin, canvas, file, baseline, canvasPath));
      }
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
export function convertWithPicker(plugin: CanvasPlusPlugin, canvas: CanvasLike, nodes: CanvasNodeLike[], onDone: () => void, source: TypeSource = 'all'): void {
  const cards = nodes.filter(isConvertibleCard);
  if (picking || cards.length === 0) return;
  picking = true;
  const picker = new TypePicker(plugin, source, (target) => { void convertCards(plugin, canvas, cards, target, onDone); });
  const close = picker.onClose.bind(picker);
  picker.onClose = (): void => { close(); picking = false; };
  picker.open();
}

/**
 * Buttons in the selection menu that turn the selected text cards into notes: "Convert to…" for a note type,
 * and, with Discourse Graphs enabled, "Convert to discourse node…" for a node type.
 */
export function injectConvertButton(plugin: CanvasPlusPlugin, canvas: CanvasLike, selected: CanvasNodeLike[], onDone: () => void): void {
  const menuEl = canvas.menu?.menuEl;
  if (!menuEl || selected.length === 0 || !selected.every(isConvertibleCard)) return;
  if (plugin.hasNoteTypes) {
    button(menuEl, 'ffc-convert-btn', 'Convert to…', NOTE_TYPES_ICON, () => {
      convertWithPicker(plugin, canvas, selectedNodes(canvas), onDone, 'notes');
    });
  }
  if (plugin.hasDiscourseGraphs) {
    button(menuEl, 'ffc-convert-dg-btn', 'Convert to discourse node…', DG_NODE_ICON, () => {
      convertWithPicker(plugin, canvas, selectedNodes(canvas), onDone, 'discourse');
    });
  }
}
