import { Notice, TFile, WorkspaceLeaf } from 'obsidian';
import { DG_CONTEXT_VIEW, DG_LOGO_ICON, dgTypeOfFile } from '../discourse-graphs.ts';
import type { CanvasPlusPlugin } from '../main.ts';
import { CanvasLike, selectedNodes } from './adapter.ts';
import type { CanvasPanels } from './canvas-panels.ts';
import { showHeaderIcon } from './header-icon.ts';
import { noteOfNode } from './note-card.ts';
import { eachFrameUntil } from '../utils/helpers.ts';

/**
 * Discourse Graphs' context panel on a canvas. The panel follows the active file, which on a canvas is the
 * canvas itself, so it is told directly which node to show: the selected card's.
 */
export class DgContext {
  /** The node the panel was last asked to show. */
  private target: TFile | null = null;
  private destroyed = false;

  constructor(private plugin: CanvasPlusPlugin, private getCanvas: () => CanvasLike | undefined, private panels: CanvasPanels) {}

  /** Open the panel (or raise it) on the selected card's node. */
  open(): boolean {
    if (!this.plugin.hasDiscourseGraphs) {
      new Notice('Enable the Discourse Graphs plugin to explore discourse nodes.');
      return false;
    }
    const leaf = this.panels.openView(DG_CONTEXT_VIEW);
    this.target = null;
    if (leaf) {
      this.point(leaf, this.selectedNode(), 0);
      eachFrameUntil(() => showHeaderIcon(leaf.view.containerEl, DG_LOGO_ICON), 10);
    }
    return true;
  }

  /** While the panel is open, keep it on the selected discourse node. Cheap when nothing changed. */
  sync(): void {
    const leaf = this.panels.viewLeaf(DG_CONTEXT_VIEW);
    if (!leaf) return;
    showHeaderIcon(leaf.view.containerEl, DG_LOGO_ICON);
    const file = this.selectedNode();
    if (file && file !== this.target) this.point(leaf, file, 4);
  }

  destroy(): void {
    this.destroyed = true;
  }

  /** The note of the one selected card, if it is a discourse node. */
  private selectedNode(): TFile | null {
    const canvas = this.getCanvas();
    const selected = canvas ? selectedNodes(canvas) : [];
    const file = selected.length === 1 ? noteOfNode(selected[0]) : null;
    return file && dgTypeOfFile(this.plugin.app, file) ? file : null;
  }

  /**
   * Show `file` in the panel. A panel that has only just opened isn't ready yet, so try again a few times,
   * unless it has since been asked for another node.
   */
  private point(leaf: WorkspaceLeaf, file: TFile | null, attempt: number): void {
    if (!file) return;
    if (attempt === 0 || attempt === 4) this.target = file;
    const view = leaf.view as { setActiveFile?: (f: TFile | null) => void };
    view.setActiveFile?.(file);
    if (attempt >= 4) return;
    window.setTimeout(() => {
      if (!this.destroyed && this.target === file) this.point(leaf, file, attempt + 1);
    }, 150 * (attempt + 1));
  }
}
