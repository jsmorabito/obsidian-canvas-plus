import { PROVIDERS } from '../issues/providers.ts';
import type { Issue, ProviderId } from '../issues/types.ts';
import type { CanvasPlusPlugin } from '../main.ts';
import { CanvasLike, CanvasNodeLike } from './adapter.ts';
import { stateDot } from './issue-card.ts';
import { ItemPicker } from './item-picker.ts';
import type { IssueRef } from './issue-ref.ts';
import { addRefNode, findRefNode } from './ref-node.ts';

export function issueRef(provider: ProviderId, issue: Issue): IssueRef {
  return { provider, kind: 'issue', id: issue.id, identifier: issue.identifier, title: issue.title, url: issue.url };
}

/**
 * Add an issue (Linear's or Task App's) to the canvas. Search by words, or give an identifier (`ENG-123`) or an issue's
 * URL. With nothing typed it lists the issues updated most recently. An issue already on the canvas is selected and zoomed
 * to instead of being added twice.
 */
export class IssuePicker extends ItemPicker<Issue> {
  constructor(
    plugin: CanvasPlusPlugin,
    private provider: ProviderId,
    canvas: CanvasLike,
    at: { x: number; y: number } | null,
    onAdded: () => void,
  ) {
    super(plugin, canvas, at, onAdded, `Search ${PROVIDERS[provider].name}, or enter an issue identifier or URL…`);
  }

  protected noun(): string { return 'issue'; }

  protected async find(q: string): Promise<Issue[]> {
    const { client } = this.plugin.issues[this.provider];
    const identifier = client.parseRef(q);
    const exact = identifier ? await client.byIdentifier(identifier) : null;
    return exact ? [exact] : q ? await client.search(q) : await client.recent();
  }

  protected existing(issue: Issue): CanvasNodeLike | undefined {
    return findIssueNode(this.canvas, this.provider, issue.id);
  }

  protected add(issue: Issue, at: { x: number; y: number } | null): CanvasNodeLike | undefined {
    return addIssueNode(this.plugin, this.provider, this.canvas, issue, at);
  }

  renderSuggestion(issue: Issue, el: HTMLElement): void {
    el.addClass('ffc-picker-row');
    const main = el.createDiv({ cls: 'ffc-issue-suggestion' });
    stateDot(main, issue.state);
    main.createSpan({ cls: 'ffc-issue-id', text: issue.identifier });
    main.createSpan({ cls: 'suggestion-title', text: issue.title });
  }
}

/** The node already showing this issue, if any. */
export function findIssueNode(canvas: CanvasLike, provider: ProviderId, id: string): CanvasNodeLike | undefined {
  return findRefNode(canvas, 'issue', provider, id);
}

/**
 * Add a card for an issue, as one undo step. `at` is where its centre goes; without it, the nearest free
 * spot to the middle of the view.
 */
export function addIssueNode(
  plugin: CanvasPlusPlugin, provider: ProviderId, canvas: CanvasLike, issue: Issue, at: { x: number; y: number } | null,
): CanvasNodeLike | undefined {
  // Known before the card is drawn, so it shows the issue at once.
  plugin.issues[provider].store.put(issue);
  return addRefNode(canvas, issueRef(provider, issue), PROVIDERS[provider].field, at);
}
