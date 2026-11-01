import { MarkdownRenderer } from 'obsidian';
import type { Issue, Project, ProjectStatusType, StateType } from '../issues/types.ts';
import type { CanvasPlusPlugin } from '../main.ts';
import { CanvasLike } from './adapter.ts';
import { sourceIcon, stateDot } from './issue-card.ts';
import { PROVIDERS } from '../issues/providers.ts';
import type { IssueRef } from './issue-ref.ts';
import { cardOwner } from './note-card.ts';

// A Linear project drawn the way an issue is: the same card, full view and link, with the project's own facts.

/** The marker for a project's status, using the issue markers: a ring, half full or full. */
const MARKER: Record<ProjectStatusType, StateType> = {
  backlog: 'backlog', planned: 'unstarted', started: 'started', paused: 'started', completed: 'completed', canceled: 'canceled',
};

export function projectMarker(parent: HTMLElement, project: Project | undefined): void {
  const status = project?.status;
  const state: Issue['state'] = status ? { name: status.name, type: MARKER[status.type] ?? 'backlog', color: status.color } : null;
  stateDot(parent, state);
}

function percent(project: Project): string | null {
  return project.progress === null ? null : `${Math.round(project.progress * 100)}%`;
}

export function renderProjectCard(card: HTMLElement, ref: IssueRef, project: Project | undefined): void {
  card.empty();
  const head = card.createDiv({ cls: 'ffc-issue-head' });
  sourceIcon(head, ref.provider);
  projectMarker(head, project);
  head.createSpan({ cls: 'ffc-issue-id', text: 'Project' });
  card.createDiv({ cls: 'ffc-issue-title', text: project?.name ?? ref.title });
  if (!project) return;
  const meta = card.createDiv({ cls: 'ffc-issue-meta' });
  if (project.status) meta.createSpan({ cls: 'ffc-issue-chip', text: project.status.name });
  const done = percent(project);
  if (done) meta.createSpan({ cls: 'ffc-issue-chip', text: done });
  if (project.lead) meta.createSpan({ cls: 'ffc-issue-chip', text: project.lead.name });
  if (project.targetDate) meta.createSpan({ cls: 'ffc-issue-chip', text: project.targetDate });
}

export function renderProjectPill(pill: HTMLElement, ref: IssueRef, project: Project | undefined): void {
  pill.empty();
  const chip = pill.createDiv({ cls: 'ffc-issue-pill-body' });
  sourceIcon(chip, ref.provider);
  projectMarker(chip, project);
  chip.createSpan({ cls: 'ffc-issue-pill-title', text: project?.name ?? ref.title });
}

export function renderProjectEmbed(
  plugin: CanvasPlusPlugin, canvas: CanvasLike, embed: HTMLElement, ref: IssueRef, project: Project | undefined,
): void {
  embed.empty();
  const head = embed.createDiv({ cls: 'ffc-issue-head' });
  sourceIcon(head, ref.provider);
  projectMarker(head, project);
  head.createEl('a', { cls: 'ffc-issue-id external-link', text: 'Project', href: ref.url });
  embed.createDiv({ cls: 'ffc-issue-title', text: project?.name ?? ref.title });
  if (!project) {
    const name = PROVIDERS[ref.provider].name;
    embed.createDiv({ cls: 'ffc-issue-note', text: plugin.hasIssues(ref.provider) ? `Loading from ${name}…` : `Set up ${name} in the Canvas Plus settings to show the project.` });
    return;
  }

  const props = embed.createDiv({ cls: 'ffc-issue-props' });
  const row = (label: string, value: string): void => {
    props.createSpan({ cls: 'ffc-issue-prop-label', text: label });
    props.createSpan({ cls: 'ffc-issue-prop-value', text: value });
  };
  if (project.status) row('Status', project.status.name);
  const done = percent(project);
  if (done) row('Progress', done);
  if (project.lead) row('Lead', project.lead.name);
  if (project.startDate) row('Start', project.startDate);
  if (project.targetDate) row('Target', project.targetDate);
  if (project.teams.length > 0) row('Teams', project.teams.map((t) => t.name).join(', '));

  const text = project.content || project.description;
  const owner = cardOwner(canvas);
  if (text && owner) {
    const body = embed.createDiv({ cls: 'markdown-rendered ffc-issue-body' });
    void MarkdownRenderer.render(plugin.app, text, body, '', owner);
  }
}
