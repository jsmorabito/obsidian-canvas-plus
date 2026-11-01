import type { Issue, RefItem } from '../issues/types.ts';
import { initiativeMarker } from './initiative-card.ts';
import { stateDot } from './issue-card.ts';
import type { IssueRef } from './issue-ref.ts';
import { projectMarker } from './project-card.ts';

/** What one row of the panel says about an issue or a project. */
export interface RowParts {
  identifier: string;
  title: string;
  status?: string;
  assignee?: string;
  /** Draws the status marker at the start of the row. */
  mark: (parent: HTMLElement) => void;
}

export function issueParts(issue: Issue): RowParts {
  return { identifier: issue.identifier, title: issue.title, status: issue.state?.name, assignee: issue.assignee?.name, mark: (el) => stateDot(el, issue.state) };
}

/** An item on the canvas as a row: the service's version of it if that has loaded, else what the node saved. */
export function placedParts(ref: IssueRef, found: RefItem | undefined): RowParts {
  if (found?.kind === 'issue') return issueParts(found.item);
  if (ref.kind === 'issue') return { identifier: ref.identifier, title: ref.title, mark: (el) => stateDot(el, null) };
  if (ref.kind === 'project') {
    const project = found?.kind === 'project' ? found.item : undefined;
    return { identifier: 'Project', title: project?.name ?? ref.title, status: project?.status?.name, assignee: project?.lead?.name, mark: (el) => projectMarker(el, project) };
  }
  const initiative = found?.kind === 'initiative' ? found.item : undefined;
  return { identifier: 'Initiative', title: initiative?.name ?? ref.title, status: initiative?.status, assignee: initiative?.owner?.name, mark: (el) => initiativeMarker(el, initiative) };
}

/** One item in core's tree row markup: its status, title and a line under it, with room at the right for an action. */
export function treeRow(parent: HTMLElement, parts: RowParts): { item: HTMLElement; self: HTMLElement; flair: HTMLElement } {
  const item = parent.createDiv({ cls: 'tree-item ffc-linear-row' });
  const self = item.createDiv({ cls: 'tree-item-self is-clickable' });
  parts.mark(self);
  const inner = self.createDiv({ cls: 'tree-item-inner' });
  inner.createDiv({ cls: 'ffc-linear-row-title', text: parts.title });
  inner.createDiv({ cls: 'ffc-linear-row-meta u-muted', text: [parts.identifier, parts.status, parts.assignee].filter(Boolean).join(' · ') });
  const flair = self.createDiv({ cls: 'tree-item-flair-outer' }).createSpan({ cls: 'tree-item-flair' });
  return { item, self, flair };
}
