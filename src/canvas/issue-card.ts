import { MarkdownRenderer } from 'obsidian';
import { PROVIDERS } from '../issues/providers.ts';
import type { Issue } from '../issues/types.ts';
import type { CanvasPlusPlugin } from '../main.ts';
import { CanvasLike, CanvasNodeLike } from './adapter.ts';
import { IssueRef, readIssueRef } from './issue-ref.ts';
import { cardOwner, fitToPill, viewOf } from './note-card.ts';

const CARD_CLASS  = 'ffc-issue-card';
const EMBED_CLASS = 'ffc-issue-embed';
const PILL_CLASS  = 'ffc-link-pill';

/** What was last drawn into a node, so an unchanged issue isn't redrawn every sweep. */
const drawn = new WeakMap<CanvasNodeLike, { key: string; stamp: string }>();

/** Nodes whose text editing was turned off here: what they hold is the issue, not text to edit. */
const locked = new WeakSet<CanvasNodeLike>();

/**
 * Dress text nodes that show an issue (Linear's or Task App's): a card, the full issue or a link, in place of the node's own text
 * (changed from the selection toolbar, like a note card). Idempotent, so safe to run on a timer.
 */
export function decorateIssueCards(plugin: CanvasPlusPlugin, canvas: CanvasLike): void {
  for (const node of canvas.nodes?.values() ?? []) {
    const el = node.nodeEl;
    if (!el) continue;
    const ref = readIssueRef(node);
    const container = el.querySelector<HTMLElement>('.canvas-node-container');
    if (!ref || !container) {
      clearIssue(node);
      continue;
    }

    const mode = viewOf(node);
    el.setAttribute('data-ffc-issue', ref.id);
    el.setAttribute('data-ffc-view', mode);
    lockEditing(node);
    const { store } = plugin.issues[ref.provider];
    store.request(ref.id);
    const issue = store.get(ref.id);
    const key = `${mode}|${ref.provider}|${ref.id}|${ref.identifier}|${ref.title}`;
    // By when it last changed, not by the fetched object: a refetch of an unchanged issue must not rebuild the card,
    // which would send a scrolled embed back to the top.
    const stamp = issue?.updatedAt ?? '';
    const fresh = drawn.get(node)?.key === key && drawn.get(node)?.stamp === stamp;
    drawn.set(node, { key, stamp });

    const card = container.querySelector<HTMLElement>(`.${CARD_CLASS}`);
    const embed = container.querySelector<HTMLElement>(`.${EMBED_CLASS}`);
    const pill = container.querySelector<HTMLElement>(`.${PILL_CLASS}`);
    if (mode !== 'card') card?.remove();
    if (mode !== 'embed') embed?.remove();
    if (mode !== 'link') pill?.remove();

    if (mode === 'card') {
      const target = card ?? container.createDiv({ cls: CARD_CLASS });
      if (!fresh || target.childElementCount === 0) renderCard(target, ref, issue);
    } else if (mode === 'embed') {
      const target = embed ?? container.createDiv({ cls: EMBED_CLASS });
      if (!fresh || target.childElementCount === 0) renderEmbed(plugin, canvas, target, ref, issue);
    } else {
      const target = pill ?? container.createDiv({ cls: `${PILL_CLASS} ffc-issue-pill` });
      if (!fresh || target.childElementCount === 0) renderPill(target, ref, issue);
      fitToPill(canvas, node, target, container);
    }
  }
}

function lockEditing(node: CanvasNodeLike): void {
  if (locked.has(node)) return;
  locked.add(node);
  node.startEditing = () => { /* an issue isn't edited as text */ };
}

function clearIssue(node: CanvasNodeLike): void {
  if (locked.delete(node)) Reflect.deleteProperty(node, 'startEditing');
  const el = node.nodeEl;
  if (!el?.hasAttribute('data-ffc-issue')) return;
  el.querySelector(`.${CARD_CLASS}`)?.remove();
  el.querySelector(`.${EMBED_CLASS}`)?.remove();
  el.querySelector('.ffc-issue-pill')?.remove();
  el.removeAttribute('data-ffc-issue');
  el.removeAttribute('data-ffc-view');
  drawn.delete(node);
}

export function clearIssueCards(canvas: CanvasLike): void {
  for (const node of canvas.nodes?.values() ?? []) clearIssue(node);
}

/** The status marker: a ring for not started, half full for started, full for done, in the status's own colour. */
export function stateDot(parent: HTMLElement, state: Issue['state']): void {
  const dot = parent.createSpan({ cls: 'ffc-issue-state', attr: { 'data-state-type': state?.type ?? 'backlog' } });
  if (state?.color) dot.setCssProps({ '--ffc-issue-color': state.color });
}

function labelChip(parent: HTMLElement, label: { name: string; color: string }): void {
  const chip = parent.createSpan({ cls: 'ffc-issue-chip ffc-issue-label' });
  chip.createSpan({ cls: 'ffc-issue-label-dot' }).setCssProps({ '--ffc-issue-color': label.color });
  chip.createSpan({ text: label.name });
}

function renderCard(card: HTMLElement, ref: IssueRef, issue: Issue | undefined): void {
  card.empty();
  const head = card.createDiv({ cls: 'ffc-issue-head' });
  stateDot(head, issue?.state ?? null);
  head.createSpan({ cls: 'ffc-issue-id', text: ref.identifier });
  if (issue && issue.priority > 0) head.createSpan({ cls: 'ffc-issue-priority', text: issue.priorityLabel });
  card.createDiv({ cls: 'ffc-issue-title', text: issue?.title ?? ref.title });
  if (!issue) return;
  const meta = card.createDiv({ cls: 'ffc-issue-meta' });
  if (issue.state) meta.createSpan({ cls: 'ffc-issue-chip', text: issue.state.name });
  if (issue.assignee) meta.createSpan({ cls: 'ffc-issue-chip', text: issue.assignee.name });
  for (const label of issue.labels) labelChip(meta, label);
}

function renderPill(pill: HTMLElement, ref: IssueRef, issue: Issue | undefined): void {
  pill.empty();
  const chip = pill.createDiv({ cls: 'ffc-issue-pill-body' });
  stateDot(chip, issue?.state ?? null);
  chip.createSpan({ cls: 'ffc-issue-id', text: ref.identifier });
  chip.createSpan({ cls: 'ffc-issue-pill-title', text: issue?.title ?? ref.title });
}

function renderEmbed(plugin: CanvasPlusPlugin, canvas: CanvasLike, embed: HTMLElement, ref: IssueRef, issue: Issue | undefined): void {
  embed.empty();
  const name = PROVIDERS[ref.provider].name;
  const head = embed.createDiv({ cls: 'ffc-issue-head' });
  stateDot(head, issue?.state ?? null);
  head.createEl('a', { cls: 'ffc-issue-id external-link', text: ref.identifier, href: ref.url });
  embed.createDiv({ cls: 'ffc-issue-title', text: issue?.title ?? ref.title });
  if (!issue) {
    embed.createDiv({
      cls: 'ffc-issue-note',
      text: plugin.hasIssues(ref.provider) ? `Loading from ${name}…` : `Set up ${name} in the Canvas Plus settings to show the issue.`,
    });
    return;
  }

  const props = embed.createDiv({ cls: 'ffc-issue-props' });
  const row = (label: string, fill: (value: HTMLElement) => void): void => {
    props.createSpan({ cls: 'ffc-issue-prop-label', text: label });
    fill(props.createSpan({ cls: 'ffc-issue-prop-value' }));
  };
  if (issue.state) row('Status', (v) => v.setText(issue.state?.name ?? ''));
  if (issue.assignee) row('Assignee', (v) => v.setText(issue.assignee?.name ?? ''));
  if (issue.priority > 0) row('Priority', (v) => v.setText(issue.priorityLabel));
  if (issue.team) row('Team', (v) => v.setText(issue.team?.name ?? ''));
  if (issue.project) row('Project', (v) => v.setText(issue.project?.name ?? ''));
  if (issue.dueDate) row('Due', (v) => v.setText(issue.dueDate ?? ''));
  if (issue.estimate !== null) row('Estimate', (v) => v.setText(String(issue.estimate)));
  if (issue.labels.length > 0) row('Labels', (v) => { for (const label of issue.labels) labelChip(v, label); });

  const owner = cardOwner(canvas);
  if (issue.description && owner) {
    const body = embed.createDiv({ cls: 'markdown-rendered ffc-issue-body' });
    void MarkdownRenderer.render(plugin.app, issue.description, body, '', owner);
  }
}
