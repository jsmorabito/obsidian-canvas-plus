import { Notice, SuggestModal } from 'obsidian';
import { PROVIDERS } from '../issues/providers.ts';
import type { Issue, ProviderId } from '../issues/types.ts';
import type { CanvasPlusPlugin } from '../main.ts';
import {
  CanvasLike, CanvasNodeLike, batch, createTextNode, focusNode, setExtra, viewportCenter,
} from './adapter.ts';
import { SIZE_ISSUE_CARD } from './constants.ts';
import { findFreeSpot } from './free-spot.ts';
import { stateDot } from './issue-card.ts';
import { IssueRef, issueNodeText, readIssueRef } from './issue-ref.ts';

/** How long typing pauses before the service is asked, so a request isn't made for every key. */
const TYPING_PAUSE_MS = 250;

export function issueRef(provider: ProviderId, issue: Issue): IssueRef {
  return { provider, id: issue.id, identifier: issue.identifier, title: issue.title, url: issue.url };
}

/**
 * Add an issue (Linear's or Task App's) to the canvas. Search by words, or give an identifier (`ENG-123`) or an issue's
 * URL. With nothing typed it lists the issues updated most recently. An issue already on the canvas is selected and zoomed
 * to instead of being added twice.
 */
export class IssuePicker extends SuggestModal<Issue> {
  private seq = 0;
  private last: Issue[] = [];

  constructor(
    private plugin: CanvasPlusPlugin,
    private provider: ProviderId,
    private canvas: CanvasLike,
    /** Drop point (canvas coordinates, card centred on it). Omit to find a free spot near the view centre. */
    private at: { x: number; y: number } | null,
    /** Called once the card is on the canvas, to dress it. */
    private onAdded: () => void,
  ) {
    super(plugin.app);
    this.setPlaceholder(`Search ${PROVIDERS[provider].name}, or enter an issue identifier or URL…`);
    this.setInstructions([
      { command: '↑↓', purpose: 'navigate' },
      { command: '↵', purpose: 'add to canvas' },
      { command: 'esc', purpose: 'dismiss' },
    ]);
  }

  async getSuggestions(query: string): Promise<Issue[]> {
    const mine = ++this.seq;
    const q = query.trim();
    if (q) await new Promise((resolve) => window.setTimeout(resolve, TYPING_PAUSE_MS));
    // Typed on since: the newer call will answer, so leave what is shown alone.
    if (mine !== this.seq) return this.last;
    const { client } = this.plugin.issues[this.provider];
    try {
      const identifier = client.parseRef(q);
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

  renderSuggestion(issue: Issue, el: HTMLElement): void {
    el.addClass('ffc-picker-row');
    const main = el.createDiv({ cls: 'ffc-issue-suggestion' });
    stateDot(main, issue.state);
    main.createSpan({ cls: 'ffc-issue-id', text: issue.identifier });
    main.createSpan({ cls: 'suggestion-title', text: issue.title });
  }

  onChooseSuggestion(issue: Issue): void {
    const existing = findIssueNode(this.canvas, this.provider, issue.id);
    if (existing) {
      focusNode(this.canvas, existing);
      return;
    }
    try {
      const node = addIssueNode(this.plugin, this.provider, this.canvas, issue, this.at);
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
export function findIssueNode(canvas: CanvasLike, provider: ProviderId, id: string): CanvasNodeLike | undefined {
  return [...canvas.nodes?.values() ?? []].find((n: CanvasNodeLike) => ((r) => r?.provider === provider && r.id === id)(readIssueRef(n)));
}

/**
 * Add a card for an issue, as one undo step. `at` is where its centre goes; without it, the nearest free
 * spot to the middle of the view.
 */
export function addIssueNode(
  plugin: CanvasPlusPlugin, provider: ProviderId, canvas: CanvasLike, issue: Issue, at: { x: number; y: number } | null,
): CanvasNodeLike | undefined {
  const size = SIZE_ISSUE_CARD;
  const pos = at
    ? { x: Math.round(at.x - size.width / 2), y: Math.round(at.y - size.height / 2) }
    : findFreeSpot(canvas, viewportCenter(canvas), size);
  const ref = issueRef(provider, issue);
  // Known before the card is drawn, so it shows the issue at once.
  plugin.issues[provider].store.put(issue);
  return batch(canvas, () => {
    const added = createTextNode(canvas, { pos, size, text: issueNodeText(ref), focus: false });
    if (added) setExtra(added, PROVIDERS[provider].field, ref);
    return added;
  });
}
