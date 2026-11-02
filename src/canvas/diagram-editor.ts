import { Modal, debounce } from 'obsidian';
import type { Mounted } from 'pele';
import type { CanvasPlusPlugin } from '../main.ts';
import { CanvasLike, CanvasNodeLike, batch, patchData } from './adapter.ts';
import { mountDiagram } from './diagram-card.ts';
import { diagramFields, keepHeld, lostHeld, readDiagram } from './diagram-data.ts';
import { restoreBeside } from './held-restore.ts';

/** Edit a diagram's Mermaid source, with Pele's drawing of it beside the text. Saving is one undo step. */
export class DiagramEditor extends Modal {
  private preview: Mounted | null = null;

  constructor(
    plugin: CanvasPlusPlugin,
    private canvas: CanvasLike,
    private node: CanvasNodeLike,
    private onSaved: () => void,
  ) {
    super(plugin.app);
    this.modalEl.addClass('ffc-diagram-editor');
    this.setTitle('Edit diagram');
  }

  onOpen(): void {
    const source = readDiagram(this.node)?.source ?? '';
    const body = this.contentEl.createDiv({ cls: 'ffc-diagram-editor-body' });
    const input = body.createEl('textarea', { cls: 'ffc-diagram-source', attr: { spellcheck: 'false', 'aria-label': 'Mermaid source' } });
    input.value = source;
    const host = body.createDiv({ cls: 'ffc-diagram ffc-diagram-preview' });
    this.preview = mountDiagram(host, source);
    const redraw = debounce(() => this.preview?.update(input.value), 200, true);
    input.addEventListener('input', redraw);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        this.save(input.value);
      }
    });

    const buttons = this.contentEl.createDiv({ cls: 'modal-button-container' });
    buttons.createEl('button', { cls: 'mod-cta', text: 'Save' }).addEventListener('click', () => this.save(input.value));
    buttons.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.close());
    input.focus();
  }

  onClose(): void {
    this.preview?.destroy();
    this.preview = null;
    this.contentEl.empty();
  }

  private save(source: string): void {
    const text = source.trim();
    if (text && text !== readDiagram(this.node)?.source) {
      const diagram = readDiagram(this.node);
      const held = keepHeld(text, diagram?.held);
      // A card whose node the new source has dropped goes back on the canvas.
      batch(this.canvas, () => {
        restoreBeside(this.canvas, this.node, lostHeld(diagram?.held, held));
        patchData(this.node, diagramFields(text, diagram?.links, held));
      });
      this.onSaved();
    }
    this.close();
  }
}
