import type { TFile } from 'obsidian';
import type { CanvasPlusPlugin } from '../main.ts';
import { CanvasLike, CanvasNodeLike, CanvasViewLike, patchData } from './adapter.ts';
import { CLICK_SLOP_PX } from './constants.ts';
import { DiagramLinks, diagramFields, readDiagram } from './diagram-data.ts';
import { hoverLink, keepLinks, linkUnder, openLink } from './diagram-links.ts';
import { FloatingTools } from './floating-tools.ts';
import { InPlaceField } from './in-place-field.ts';
import { SideEffect, batchWithEffect } from './undo-journal.ts';

/**
 * What the editors of a kind of diagram have in common: they work on a canvas, show a toolbar and dots round what is
 * picked, edit text in a field over the drawing, open a node's link when it is clicked, and save a change to the card's
 * source as one undo step. What they read, patch and offer is each kind's own.
 */
export abstract class DiagramEditorBase {
  protected field: InPlaceField | null = null;
  protected tools: FloatingTools;
  /** The last press on a node: where, and whether the node was already the one picked. */
  protected linkPress: { x: number; y: number; wasActive: boolean } | null = null;
  /** Picks out the cards of this kind of diagram. */
  protected abstract readonly cardSelector: string;

  constructor(protected plugin: CanvasPlusPlugin, protected view: CanvasViewLike, protected onChanged: () => void) {
    this.tools = new FloatingTools(view.canvas!.wrapperEl);
  }

  protected get canvas(): CanvasLike { return this.view.canvas!; }

  /** Whether `node` is the one thing selected. */
  protected isOnlySelected(node: CanvasNodeLike): boolean {
    const selection = this.canvas.selection;
    return !!selection && selection.size === 1 && selection.has(node);
  }

  /** Leave the text field, which saves it. */
  protected closeField(): void {
    const field = this.field;
    this.field = null;
    field?.close();
  }

  /**
   * Save new source for a card as one undo step, with the effect (a note made along with it) that undo takes back.
   * `beforeNotify` runs once it is saved and before the canvas is told, to say what is picked in the new source.
   */
  protected write(
    node: CanvasNodeLike, source: string, extra: { links?: DiagramLinks; effect?: SideEffect | null } = {}, beforeNotify?: () => void,
  ): void {
    // A link's address stays only while a link of that text is still in the diagram.
    const links = keepLinks(source, extra.links ?? readDiagram(node)?.links ?? {});
    batchWithEffect(this.canvas, extra.effect ?? null, () => patchData(node, diagramFields(source, links)));
    beforeNotify?.();
    this.closeField();
    this.onChanged();
  }

  /** A click on a node with a link opens it: with Cmd or Ctrl, or as a second click on the picked node. A drag isn't a click. */
  protected onLinkClick(e: MouseEvent): void {
    const link = linkUnder(e.target, this.cardSelector);
    if (!link) return;
    const press = this.linkPress;
    const still = !!press && Math.hypot(e.clientX - press.x, e.clientY - press.y) <= CLICK_SLOP_PX;
    // The second click of a double-click (which renames) isn't a click on a picked node.
    if (!(e.metaKey || e.ctrlKey) && !(still && press.wasActive && e.detail <= 1)) return;
    e.preventDefault();
    e.stopPropagation();
    openLink(this.view, link, e);
  }

  protected onHover(e: MouseEvent): void {
    const link = linkUnder(e.target, this.cardSelector);
    if (link) hoverLink(this.view, link, e);
  }

  /** The text that links a node to a note: the node's own words become the link's alias when they aren't the note's name. */
  protected noteLinkText(file: TFile, words: string): string {
    const target = this.view.app.metadataCache.fileToLinktext(file, this.view.file?.path ?? '');
    return !words || words === target || words === file.basename ? `[[${target}]]` : `[[${target}|${words}]]`;
  }
}
