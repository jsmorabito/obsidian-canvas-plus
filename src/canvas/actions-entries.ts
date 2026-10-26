import { DG_LOGO_ICON } from '../discourse-graphs.ts';
import { PANEL_ICON } from './icons.ts';
import { PROVIDERS, PROVIDER_IDS } from '../issues/providers.ts';
import type { ProviderId } from '../issues/types.ts';
import type { CanvasPlusPlugin } from '../main.ts';
import { CanvasLike, selectedNodes } from './adapter.ts';
import type { ActionEntry } from './actions-panel.ts';
import { convertWithPicker } from './convert-card.ts';
import { createIssuesFromCards, isConvertibleCard } from './issue-create.ts';

/** Open Obsidian's settings on this plugin's tab. The settings window has no public API, so this is best effort. */
export function openPluginSettings(plugin: CanvasPlusPlugin): void {
  const setting = (plugin.app as unknown as { setting?: { open?: () => void; openTabById?: (id: string) => void } }).setting;
  setting?.open?.();
  setting?.openTabById?.(plugin.manifest.id);
}

/** What the actions panel lists now: the issue actions that apply, and the way to the settings. */
export interface ActionHooks {
  openIssuePicker: (provider: ProviderId) => void;
  openIssuePanel: (provider: ProviderId) => void;
  addDiagram: () => void;
  createDiscourseNode: () => void;
  openDiscoursePanel: () => void;
  onChanged: () => void;
}

/** The key that adds an issue from a service, as the action list shows it. */
const PICKER_HINTS: Record<ProviderId, string> = { linear: 'I', taskapp: 'J' };

export function actionEntries(plugin: CanvasPlusPlugin, canvas: CanvasLike, hooks: ActionHooks): ActionEntry[] {
  const { openIssuePicker, openIssuePanel, addDiagram, createDiscourseNode, openDiscoursePanel, onChanged } = hooks;
  const entries: ActionEntry[] = [];
  const settings = (): void => openPluginSettings(plugin);

  for (const id of PROVIDER_IDS) {
    const { name, icon } = PROVIDERS[id];
    const enabled = id === 'linear' ? plugin.config.linearEnabled : plugin.config.taskAppEnabled;
    if (plugin.hasIssues(id)) {
      entries.push({ section: name, label: `Add ${name} issue…`, icon, hint: PICKER_HINTS[id], keywords: 'issue ticket task', run: () => openIssuePicker(id) });
      entries.push({
        section: name,
        label: `Open ${name} panel`,
        icon: PANEL_ICON,
        keywords: 'issues tickets tasks list explore widget',
        run: () => openIssuePanel(id),
      });
      const selected = selectedNodes(canvas);
      if (selected.length > 0 && selected.every(isConvertibleCard)) {
        entries.push({
          section: name,
          label: selected.length > 1 ? `Create ${name} issues from selected cards` : `Create ${name} issue from selected card`,
          icon: 'square-arrow-out-up-right',
          keywords: 'convert issue ticket task',
          run: () => createIssuesFromCards(plugin, id, canvas, selected, onChanged),
        });
      }
    } else {
      entries.push({
        section: name,
        label: enabled ? `Finish setting up ${name}…` : `Set up ${name} (beta)…`,
        icon,
        keywords: 'issue ticket task enable connect sign in',
        run: settings,
      });
    }
  }
  if (plugin.hasDiscourseGraphs) {
    entries.push({
      section: 'Discourse Graphs',
      label: 'Create discourse node…',
      icon: DG_LOGO_ICON,
      keywords: 'discourse graph node claim question evidence source add',
      run: createDiscourseNode,
    });
    entries.push({
      section: 'Discourse Graphs',
      label: 'Open discourse context panel',
      icon: PANEL_ICON,
      keywords: 'discourse graph explore relations context node',
      run: openDiscoursePanel,
    });
  }
  entries.push({ section: 'Canvas Plus', label: 'Add diagram…', icon: 'workflow', hint: 'B', keywords: 'chart mindmap flowchart mermaid pele graph', run: addDiagram });
  const chosen = selectedNodes(canvas);
  if (plugin.hasDiscourseGraphs && chosen.length > 0 && chosen.every(isConvertibleCard)) {
    entries.push({
      section: 'Discourse Graphs',
      label: chosen.length > 1 ? 'Convert selected cards to discourse nodes…' : 'Convert selected card to discourse node…',
      icon: DG_LOGO_ICON,
      keywords: 'convert discourse graph node claim question evidence source',
      run: () => convertWithPicker(plugin, canvas, chosen, onChanged, 'discourse'),
    });
  }
  if (plugin.hasNoteTypes && chosen.length > 0 && chosen.every(isConvertibleCard)) {
    entries.push({
      section: 'Canvas Plus',
      label: chosen.length > 1 ? 'Convert selected cards to…' : 'Convert selected card to…',
      icon: 'square-arrow-out-up-right',
      keywords: 'convert note type',
      run: () => convertWithPicker(plugin, canvas, chosen, onChanged, 'notes'),
    });
  }
  entries.push({ section: 'Canvas Plus', label: 'Open Canvas Plus settings', icon: 'settings', keywords: 'preferences options', run: settings });
  return entries;
}
