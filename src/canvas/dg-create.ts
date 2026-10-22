import { Notice, SuggestModal, TFile } from 'obsidian';
import type { CanvasPlusPlugin } from '../main.ts';
import { DgNodeType, createDgNode, dgNodeName, dgNodeTypes } from '../discourse-graphs.ts';
import {
  CanvasLike, CanvasNodeLike, canvasFilePath, createFileNode, focusNode, viewportCenter,
} from './adapter.ts';
import { SIZE_NOTE_CARD } from './constants.ts';
import { createdNoteEffect } from './created-note.ts';
import { findFreeSpot } from './free-spot.ts';
import { fitNodeToCard, noteOfNode } from './note-card.ts';
import { SideEffect, batchWithEffect } from './undo-journal.ts';

/**
 * Make a discourse node and put its card on the canvas. Type the title, then pick the node type: each row
 * shows the note's name for that type. A node already named that is selected (or added) instead.
 */
export class DgNodePicker extends SuggestModal<DgNodeType> {
  constructor(
    private plugin: CanvasPlusPlugin,
    private canvas: CanvasLike,
    private onDone: () => void,
  ) {
    super(plugin.app);
    this.setPlaceholder('Title of the discourse node…');
    this.setInstructions([
      { command: '↑↓', purpose: 'node type' },
      { command: '↵', purpose: 'create' },
      { command: 'esc', purpose: 'dismiss' },
    ]);
  }

  getSuggestions(): DgNodeType[] {
    return [...dgNodeTypes(this.app)];
  }

  renderSuggestion(type: DgNodeType, el: HTMLElement): void {
    el.addClass('ffc-picker-row');
    const named = dgNodeName(type, this.inputEl.value);
    el.createSpan({ text: 'name' in named ? named.name : `${type.name}: type a title`, cls: 'suggestion-title' });
    el.createSpan({ text: type.name, cls: 'ffc-note-chip' });
  }

  onChooseSuggestion(type: DgNodeType): void {
    const title = this.inputEl.value;
    void (async () => {
      try {
        const { file, created } = await createDgNode(this.app, type, title);
        if (!created) { this.addOrFocus(file, null); return; }
        // What the note holds right now, so undoing the card can take the note away only if nobody has touched it.
        const baseline = await this.app.vault.read(file);
        this.addOrFocus(file, createdNoteEffect(this.plugin, this.canvas, file, baseline, canvasFilePath(this.app, this.canvas)));
      } catch (err) {
        new Notice(`Could not create the node: ${(err as Error).message}`);
      }
    })();
  }

  private addOrFocus(file: TFile, effect: SideEffect | null): void {
    const existing = [...(this.canvas.nodes?.values() ?? [])].find((n: CanvasNodeLike) => noteOfNode(n)?.path === file.path);
    if (existing) {
      focusNode(this.canvas, existing);
      return;
    }
    const size = SIZE_NOTE_CARD;
    const pos = findFreeSpot(this.canvas, viewportCenter(this.canvas), size);
    const node = batchWithEffect(this.canvas, effect, () => createFileNode(this.canvas, { pos, size, file }));
    if (!node) return;
    fitNodeToCard(this.plugin, this.canvas, node);
    focusNode(this.canvas, node);
    this.onDone();
  }
}
