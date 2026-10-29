import { App, FuzzySuggestModal, TFile } from 'obsidian';
import { HTML_EXTENSIONS } from '../html/frame.ts';
import { CanvasLike, CanvasNodeLike, batch, createFileNode, focusNode, viewportCenter } from './adapter.ts';
import { SIZE_WIDGET } from './constants.ts';
import { findFreeSpot } from './free-spot.ts';

/** Files the regular file search leaves out, such as pages the canvas can render. */
const CODE_EXTENSIONS = new Set(HTML_EXTENSIONS);

/** Fuzzy search over code files, then add the chosen file to the canvas as a node. */
export class CodeFilePicker extends FuzzySuggestModal<TFile> {
  constructor(app: App, private canvas: CanvasLike, private onAdded: () => void) {
    super(app);
    this.setPlaceholder('Find an HTML file...');
    this.emptyStateText = 'No HTML files found.';
    this.setInstructions([
      { command: '↑↓', purpose: 'to navigate' },
      { command: '↵', purpose: 'to add to canvas' },
      { command: 'esc', purpose: 'to dismiss' },
    ]);
  }

  getItems(): TFile[] {
    return this.app.vault.getFiles().filter((f) => CODE_EXTENSIONS.has(f.extension.toLowerCase()));
  }

  getItemText(file: TFile): string {
    return file.path;
  }

  onChooseItem(file: TFile): void {
    const existing = [...(this.canvas.nodes?.values() ?? [])].find((n: CanvasNodeLike) => n.file?.path === file.path);
    if (existing) {
      focusNode(this.canvas, existing);
      return;
    }
    const pos = findFreeSpot(this.canvas, viewportCenter(this.canvas), SIZE_WIDGET);
    const node = batch(this.canvas, () => createFileNode(this.canvas, { pos, size: SIZE_WIDGET, file }));
    if (node) focusNode(this.canvas, node);
    this.onAdded();
  }
}
