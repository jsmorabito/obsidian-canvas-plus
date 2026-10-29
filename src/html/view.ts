import { FileView, TFile, WorkspaceLeaf } from 'obsidian';
import { HTML_EXTENSIONS, mountHtmlFrame } from './frame.ts';

export { HTML_EXTENSIONS };

export const HTML_VIEW = 'canvas-plus-html';

/** An HTML file opened in a tab, rendered in a sandboxed frame. */
export class HtmlView extends FileView {
  private reload: (() => Promise<void>) | null = null;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
    this.navigation = true;
    // Once for the view's life: a tab can load several files in turn.
    this.registerEvent(this.app.vault.on('modify', (changed) => {
      if (changed === this.file) void this.reload?.();
    }));
  }

  getViewType(): string {
    return HTML_VIEW;
  }

  getIcon(): string {
    return 'file-code';
  }

  async onLoadFile(file: TFile): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass('ffc-html-view');
    const { reload } = mountHtmlFrame(this.app, this.contentEl, file);
    this.reload = reload;
    await reload();
  }

  onUnloadFile(): Promise<void> {
    this.reload = null;
    this.contentEl.empty();
    return Promise.resolve();
  }
}
