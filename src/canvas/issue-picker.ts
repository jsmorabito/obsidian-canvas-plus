import { Notice, SuggestModal } from 'obsidian';
import { LinearIssue, parseIssueRef } from '../linear/api.ts';
import type { CanvasPlusPlugin } from '../main.ts';
import {
  CanvasLike, CanvasNodeLike, batch, createTextNode, focusNode, setExtra, viewportCenter,
} from './adapter.ts';
import { FIELD_LINEAR, SIZE_ISSUE_CARD } from './constants.ts';
import { findFreeSpot } from './free-spot.ts';
import { stateDot } from './linear-card.ts';
import { LinearRef, linearNodeText, readLinearRef } from './linear-ref.ts';

/** How long typing pauses before Linear is asked, so a request isn't made for every key. */
const TYPING_PAUSE_MS = 250;

export function issueRef(issue: LinearIssue): LinearRef {
  return { id: issue.id, identifier: issue.identifier, title: issue.title, url: issue.url };
}

/**
 * Add a Linear issue to the canvas. Search by words, or give an identifier (`ENG-123`) or an issue's URL. With
 * nothing typed it lists the issues updated most recently. An issue already on the canvas is selected and zoomed
 * to instead of being added twice.
 */
export class LinearPicker extends SuggestModal<LinearIssue> {
  private seq = 0;
  private last: LinearIssue[] = [];

  constructor(
    private plugin: CanvasPlusPlugin,
    private canvas: CanvasLike,
    /** Drop point (canvas coordinates, card centred on it). Omit to find a free spot near the view centre. */
    private at: { x: number; y: number } | null,
    /** Called once the card is on the canvas, to dress it. */
    private onAdded: () => void,
  ) {
    super(plugin.app);
    this.setPlaceholder('Search Linear, or enter an issue identifier or URL…');
    this.setInstructions([
      { command: '↑↓', purpose: 'navigate' },
      { command: '↵', purpose: 'add to canvas' },
      { command: 'esc', purpose: 'dismiss' },
    ]);
  }

  async getSuggestions(query: string): Promise<LinearIssue[]> {
    const mine = ++this.seq;
    const q = query.trim();
    if (q) await new Promise((resolve) => window.setTimeout(resolve, TYPING_PAUSE_MS));
    // Typed on since: the newer call will answer, so leave what is shown alone.
    if (mine !== this.seq) return this.last;
    const { client } = this.plugin.linear;
    try {
      const identifier = parseIssueRef(q);
      const exact = identifier ? await client.byIdentifier(identifier) : null;
      const found = exact ? [exact] : q ? await client.search(q) : await client.recent();
      if (mine !== this.seq) return this.last;
      this.emptyStateText = 'No issues found.';
      this.last = found;
      return found;
    } catch (err) {
      if (mine === this.seq) {
        this.emptyStateText = (err as Error).message;
        this.last = [];
      }
      return [];
    }
  }

  renderSuggestion(issue: LinearIssue, el: HTMLElement): void {
    el.addClass('ffc-picker-row');
    const main = el.createDiv({ cls: 'ffc-issue-suggestion' });
    stateDot(main, issue.state);
    main.createSpan({ cls: 'ffc-issue-id', text: issue.identifier });
    main.createSpan({ cls: 'suggestion-title', text: issue.title });
  }

  onChooseSuggestion(issue: LinearIssue): void {
    const existing = findIssueNode(this.canvas, issue.id);
    if (existing) {
      focusNode(this.canvas, existing);
      return;
    }
    try {
      const node = addIssueNode(this.plugin, this.canvas, issue, this.at);
      if (!node) return;
      this.onAdded();
      if (this.at) {
        this.canvas.deselectAll?.();
        this.canvas.selectOnly?.(node);
      } else {
        focusNode(this.canvas, node);
      }
    } catch (err) {
      new Notice(`Could not add issue to canvas: ${(err as Error).message}`);
    }
  }
}

/** The node already showing this issue, if any. */
export function findIssueNode(canvas: CanvasLike, id: string): CanvasNodeLike | undefined {
  return [...canvas.nodes?.values() ?? []].find((n: CanvasNodeLike) => readLinearRef(n)?.id === id);
}

/**
 * Add a card for an issue, as one undo step. `at` is where its centre goes; without it, the nearest free
 * spot to the middle of the view.
 */
export function addIssueNode(
  plugin: CanvasPlusPlugin, canvas: CanvasLike, issue: LinearIssue, at: { x: number; y: number } | null,
): CanvasNodeLike | undefined {
  const size = SIZE_ISSUE_CARD;
  const pos = at
    ? { x: Math.round(at.x - size.width / 2), y: Math.round(at.y - size.height / 2) }
    : findFreeSpot(canvas, viewportCenter(canvas), size);
  const ref = issueRef(issue);
  // Known before the card is drawn, so it shows the issue at once.
  plugin.linear.store.put(issue);
  return batch(canvas, () => {
    const added = createTextNode(canvas, { pos, size, text: linearNodeText(ref), focus: false });
    if (added) setExtra(added, FIELD_LINEAR, ref);
    return added;
  });
}
