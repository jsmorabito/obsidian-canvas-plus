import { PROVIDERS } from '../issues/providers.ts';
import type { Project, ProviderId } from '../issues/types.ts';
import type { CanvasPlusPlugin } from '../main.ts';
import { CanvasLike, CanvasNodeLike } from './adapter.ts';
import { ItemPicker } from './item-picker.ts';
import type { IssueRef } from './issue-ref.ts';
import { projectMarker } from './project-card.ts';
import { addRefNode, findRefNode } from './ref-node.ts';

export function projectRef(provider: ProviderId, project: Project): IssueRef {
  return { provider, kind: 'project', id: project.id, identifier: '', title: project.name, url: project.url };
}

/**
 * Add a project (Linear's or Task App's) to the canvas. Search by words, or give a project's URL. With nothing typed it
 * lists the projects updated most recently. A project already on the canvas is selected and zoomed to instead of being
 * added twice.
 */
export class ProjectPicker extends ItemPicker<Project> {
  constructor(
    plugin: CanvasPlusPlugin,
    private provider: ProviderId,
    canvas: CanvasLike,
    at: { x: number; y: number } | null,
    onAdded: () => void,
  ) {
    super(plugin, canvas, at, onAdded, `Search ${PROVIDERS[provider].name} projects, or enter a project URL…`);
  }

  protected noun(): string { return 'project'; }

  protected async find(q: string): Promise<Project[]> {
    const { client } = this.plugin.issues[this.provider];
    const ref = client.parseProjectRef(q);
    const exact = ref ? await client.projectByRef(ref) : null;
    return exact ? [exact] : q ? await client.searchProjects(q) : await client.recentProjects();
  }

  protected existing(project: Project): CanvasNodeLike | undefined {
    return findProjectNode(this.canvas, this.provider, project.id);
  }

  protected add(project: Project, at: { x: number; y: number } | null): CanvasNodeLike | undefined {
    return addProjectNode(this.plugin, this.provider, this.canvas, project, at);
  }

  renderSuggestion(project: Project, el: HTMLElement): void {
    el.addClass('ffc-picker-row');
    const main = el.createDiv({ cls: 'ffc-issue-suggestion' });
    projectMarker(main, project);
    main.createSpan({ cls: 'suggestion-title', text: project.name });
  }
}

/** The node already showing this project, if any. */
export function findProjectNode(canvas: CanvasLike, provider: ProviderId, id: string): CanvasNodeLike | undefined {
  return findRefNode(canvas, 'project', provider, id);
}

/** Add a card for a project, as one undo step. `at` is where its centre goes; without it, the nearest free spot to the middle of the view. */
export function addProjectNode(
  plugin: CanvasPlusPlugin, provider: ProviderId, canvas: CanvasLike, project: Project, at: { x: number; y: number } | null,
): CanvasNodeLike | undefined {
  // Known before the card is drawn, so it shows the project at once.
  plugin.projects[provider].put(project);
  return addRefNode(canvas, projectRef(provider, project), PROVIDERS[provider].projectField, at);
}
