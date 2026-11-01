import { App, FuzzySuggestModal, Keymap, TFile } from 'obsidian';
import type { CanvasPlusPlugin } from '../main.ts';

/** Fuzzy search over every canvas in the vault, then open the chosen one. */
export class CanvasFilePicker extends FuzzySuggestModal<TFile> {
  constructor(app: App) {
    super(app);
    this.setPlaceholder('Find a canvas...');
    this.emptyStateText = 'No canvases found.';
    this.setInstructions([
      { command: '↑↓', purpose: 'to navigate' },
      { command: '↵', purpose: 'to open' },
      { command: 'cmd ↵', purpose: 'to open in a new tab' },
      { command: 'esc', purpose: 'to dismiss' },
    ]);
  }

  /** Most recently modified first, so the empty search shows what you were just working on. */
  getItems(): TFile[] {
    return this.app.vault.getFiles()
      .filter((f) => f.extension.toLowerCase() === 'canvas')
      .sort((a, b) => b.stat.mtime - a.stat.mtime);
  }

  getItemText(file: TFile): string {
    return file.path;
  }

  onChooseItem(file: TFile, evt: MouseEvent | KeyboardEvent): void {
    void this.app.workspace.getLeaf(Keymap.isModEvent(evt)).openFile(file);
  }
}

export function registerOpenCanvas(plugin: CanvasPlusPlugin): void {
  plugin.addCommand({
    id: 'open-canvas',
    name: 'Open canvas',
    callback: () => new CanvasFilePicker(plugin.app).open(),
  });
}
