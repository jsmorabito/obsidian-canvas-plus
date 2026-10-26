import { SuggestModal } from 'obsidian';
import type { CanvasPlusPlugin } from '../main.ts';
import { CanvasLike, batch, createTextNode, patchData, viewportCenter } from './adapter.ts';
import { FIELD_DIAGRAM, SIZE_DIAGRAM } from './constants.ts';
import { DIAGRAM_TEMPLATES, DiagramTemplate, diagramText } from './diagram-data.ts';
import { findFreeSpot } from './free-spot.ts';

/** Pick a kind of diagram to add to the canvas, near the middle of the view. */
export class DiagramPicker extends SuggestModal<DiagramTemplate> {
  constructor(plugin: CanvasPlusPlugin, private canvas: CanvasLike, private onAdded: () => void) {
    super(plugin.app);
    this.setPlaceholder('Add a diagram to the canvas…');
    this.setInstructions([
      { command: '↑↓', purpose: 'navigate' },
      { command: '↵', purpose: 'add to canvas' },
      { command: 'esc', purpose: 'dismiss' },
    ]);
  }

  getSuggestions(query: string): DiagramTemplate[] {
    const q = query.trim().toLowerCase();
    return DIAGRAM_TEMPLATES.filter((t) => t.name.toLowerCase().includes(q));
  }

  renderSuggestion(template: DiagramTemplate, el: HTMLElement): void {
    el.setText(template.name);
  }

  onChooseSuggestion(template: DiagramTemplate): void {
    const canvas = this.canvas;
    const pos = findFreeSpot(canvas, viewportCenter(canvas), SIZE_DIAGRAM);
    const node = batch(canvas, () => {
      const created = createTextNode(canvas, { pos, size: SIZE_DIAGRAM, text: diagramText(template.source), focus: false });
      if (created) patchData(created, { [FIELD_DIAGRAM]: { source: template.source } });
      return created;
    });
    if (node) {
      canvas.deselectAll?.();
      canvas.selectOnly?.(node);
    }
    this.onAdded();
    window.requestAnimationFrame(() => this.onAdded());
  }
}
