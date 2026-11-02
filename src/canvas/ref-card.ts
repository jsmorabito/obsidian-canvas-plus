import { MarkdownRenderer } from 'obsidian';
import { PROVIDERS } from '../issues/providers.ts';
import type { RefItem } from '../issues/types.ts';
import type { CanvasPlusPlugin } from '../main.ts';
import { CanvasLike } from './adapter.ts';
import { initiativeFacts } from './initiative-card.ts';
import { sourceIcon, stateDot } from './issue-card.ts';
import type { IssueRef } from './issue-ref.ts';
import { cardOwner } from './note-card.ts';
import { projectFacts } from './project-card.ts';
import { refLabel } from './ref-label.ts';

// A project or an initiative drawn the way an issue is: the same card, full view and link, with its own facts.

/** What a card says about a project or an initiative. */
export interface RefFacts {
  name: string;
  /** Draws the status marker. */
  mark: (parent: HTMLElement) => void;
  chips: string[];
  props: Array<[label: string, value: string]>;
  /** Markdown shown under the properties in the full view. */
  body: string;
}

/** The facts to draw for what the service returned, or undefined while it has not loaded. */
export function refFacts(found: RefItem | undefined): RefFacts | undefined {
  if (found?.kind === 'initiative') return initiativeFacts(found.item);
  return found?.kind === 'project' ? projectFacts(found.item) : undefined;
}

const unknownMark = (parent: HTMLElement): void => stateDot(parent, null);

export function renderRefCard(card: HTMLElement, ref: IssueRef, facts: RefFacts | undefined): void {
  card.empty();
  const head = card.createDiv({ cls: 'ffc-issue-head' });
  sourceIcon(head, ref.provider);
  (facts?.mark ?? unknownMark)(head);
  head.createSpan({ cls: 'ffc-issue-id', text: refLabel(ref.kind) });
  card.createDiv({ cls: 'ffc-issue-title', text: facts?.name ?? ref.title });
  if (!facts) return;
  const meta = card.createDiv({ cls: 'ffc-issue-meta' });
  for (const chip of facts.chips) meta.createSpan({ cls: 'ffc-issue-chip', text: chip });
}

export function renderRefPill(pill: HTMLElement, ref: IssueRef, facts: RefFacts | undefined): void {
  pill.empty();
  const chip = pill.createDiv({ cls: 'ffc-issue-pill-body' });
  sourceIcon(chip, ref.provider);
  (facts?.mark ?? unknownMark)(chip);
  chip.createSpan({ cls: 'ffc-issue-pill-title', text: facts?.name ?? ref.title });
}

export function renderRefEmbed(
  plugin: CanvasPlusPlugin, canvas: CanvasLike, embed: HTMLElement, ref: IssueRef, facts: RefFacts | undefined,
): void {
  embed.empty();
  const head = embed.createDiv({ cls: 'ffc-issue-head' });
  sourceIcon(head, ref.provider);
  (facts?.mark ?? unknownMark)(head);
  head.createEl('a', { cls: 'ffc-issue-id external-link', text: refLabel(ref.kind), href: ref.url });
  embed.createDiv({ cls: 'ffc-issue-title', text: facts?.name ?? ref.title });
  if (!facts) {
    const name = PROVIDERS[ref.provider].name;
    const noun = refLabel(ref.kind).toLowerCase();
    embed.createDiv({ cls: 'ffc-issue-note', text: plugin.hasIssues(ref.provider) ? `Loading from ${name}…` : `Set up ${name} in the Canvas Plus settings to show the ${noun}.` });
    return;
  }

  const props = embed.createDiv({ cls: 'ffc-issue-props' });
  for (const [label, value] of facts.props) {
    props.createSpan({ cls: 'ffc-issue-prop-label', text: label });
    props.createSpan({ cls: 'ffc-issue-prop-value', text: value });
  }
  const owner = cardOwner(canvas);
  if (facts.body && owner) {
    const body = embed.createDiv({ cls: 'markdown-rendered ffc-issue-body' });
    void MarkdownRenderer.render(plugin.app, facts.body, body, '', owner);
  }
}
