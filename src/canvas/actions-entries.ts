import type { CanvasPlusPlugin } from '../main.ts';
import { CanvasLike, selectedNodes } from './adapter.ts';
import type { ActionEntry } from './actions-panel.ts';
import { LINEAR_ICON } from './icons.ts';
import { createIssuesFromCards, isConvertibleCard } from './linear-create.ts';

/** Open Obsidian's settings on this plugin's tab. The settings window has no public API, so this is best effort. */
export function openPluginSettings(plugin: CanvasPlusPlugin): void {
  const setting = (plugin.app as unknown as { setting?: { open?: () => void; openTabById?: (id: string) => void } }).setting;
  setting?.open?.();
  setting?.openTabById?.(plugin.manifest.id);
}

/** What the actions panel lists now: the Linear actions that apply, and the way to the settings. */
export interface ActionHooks {
  openLinearPicker: () => void;
  openLinearPanel: () => void;
  onChanged: () => void;
}

export function actionEntries(plugin: CanvasPlusPlugin, canvas: CanvasLike, hooks: ActionHooks): ActionEntry[] {
  const { openLinearPicker, openLinearPanel, onChanged } = hooks;
  const entries: ActionEntry[] = [];
  const settings = (): void => openPluginSettings(plugin);

  if (plugin.hasLinear) {
    entries.push({
      section: 'Linear',
      label: 'Open Linear panel',
      icon: 'panel-right',
      keywords: 'issues tickets list explore widget',
      run: openLinearPanel,
    });
    entries.push({ section: 'Linear', label: 'Add Linear issue…', icon: LINEAR_ICON, hint: 'I', keywords: 'issue ticket', run: openLinearPicker });
    const selected = selectedNodes(canvas);
    if (selected.length > 0 && selected.every(isConvertibleCard)) {
      entries.push({
        section: 'Linear',
        label: selected.length > 1 ? 'Create Linear issues from selected cards' : 'Create Linear issue from selected card',
        icon: 'square-arrow-out-up-right',
        keywords: 'convert issue ticket',
        run: () => createIssuesFromCards(plugin, canvas, selected, onChanged),
      });
    }
  } else {
    const enabled = plugin.config.linearEnabled;
    entries.push({
      section: 'Linear',
      label: enabled ? 'Sign in to Linear…' : 'Set up Linear (beta)…',
      icon: LINEAR_ICON,
      keywords: 'issue ticket enable connect',
      run: settings,
    });
  }
  entries.push({ section: 'Canvas Plus', label: 'Open Canvas Plus settings', icon: 'settings', keywords: 'preferences options', run: settings });
  return entries;
}
