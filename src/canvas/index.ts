import { ItemView, WorkspaceLeaf, debounce } from 'obsidian';
import type { CanvasPlusPlugin } from '../main.ts';
import { asCanvasView } from './adapter.ts';
import { CanvasController } from './controller.ts';
import { registerIcons } from './icons.ts';
import { PanelStore } from './panel-store.ts';

/**
 * Attaches canvas tools (toolbar, shortcuts, placement) to every open canvas
 * view, and tears them down on unload.
 */
export function registerCanvasTools(plugin: CanvasPlusPlugin): void {
  plugin.register(registerIcons());
  // The tray's open state used to be saved across canvases; it no longer is.
  plugin.app.saveLocalStorage('ffc-canvas-tray-open', null);
  const panelStore = new PanelStore(plugin, plugin.pluginData);
  const controllers = new Map<ItemView, CanvasController>();

  const sync = (): void => {
    const seen = new Set<ItemView>();
    plugin.app.workspace.iterateAllLeaves((leaf: WorkspaceLeaf) => {
      const view = asCanvasView(leaf.view);
      if (!view) return;
      seen.add(view);
      // A canvas moved into (or out of) a popout window now lives in another document: start over there.
      const existing = controllers.get(view);
      if (existing && existing.doc !== view.containerEl.doc) {
        existing.destroy();
        controllers.delete(view);
      }
      if (!controllers.has(view)) {
        controllers.set(view, new CanvasController(plugin, view, panelStore));
      }
    });
    for (const [view, controller] of controllers) {
      if (seen.has(view)) continue;
      controller.destroy();
      controllers.delete(view);
    }
  };
  const activeController = (): CanvasController | undefined => {
    const view = plugin.app.workspace.getActiveViewOfType(ItemView);
    return view ? controllers.get(view) : undefined;
  };
  plugin.addCommand({
    id: 'toggle-canvas-note-card',
    name: 'Cycle selected canvas note cards and Linear issues between card, embed and link',
    checkCallback: (checking) => {
      const controller = activeController();
      if (!controller) return false;
      if (!checking) controller.toggleSelectedCards();
      return true;
    },
  });
  plugin.addCommand({
    id: 'add-linear-issue-to-canvas',
    name: 'Add Linear issue to canvas',
    checkCallback: (checking) => {
      const controller = activeController();
      if (!controller || !plugin.hasLinear) return false;
      if (!checking) controller.openLinearPicker();
      return true;
    },
  });
  plugin.addCommand({
    id: 'toggle-canvas-presentation',
    name: 'Toggle presentation',
    checkCallback: (checking) => {
      const controller = activeController();
      if (!controller) return false;
      if (!checking) controller.presenter.toggle();
      return true;
    },
  });
  plugin.addCommand({
    id: 'toggle-canvas-focus',
    name: 'Toggle canvas focus',
    checkCallback: (checking) => {
      const controller = activeController();
      if (!controller) return false;
      if (!checking) controller.focuser.toggle();
      return true;
    },
  });
  // Only offered while presenting, for a hotkey or a presentation clicker.
  for (const [id, name, step] of [
    ['next-presentation-stop', 'Next presentation stop', 'next'],
    ['previous-presentation-stop', 'Previous presentation stop', 'previous'],
  ] as const) {
    plugin.addCommand({
      id,
      name,
      checkCallback: (checking) => {
        const presenter = activeController()?.presenter;
        if (!presenter?.presenting) return false;
        if (!checking) presenter[step]();
        return true;
      },
    });
  }
  // The canvas mounts a beat after its leaf appears.
  const syncSoon = (): void => { window.setTimeout(() => { sync(); sweepVisible(); }, 50); };

  plugin.app.workspace.onLayoutReady(sync);
  plugin.registerEvent(plugin.app.workspace.on('active-leaf-change', syncSoon));
  plugin.registerEvent(plugin.app.workspace.on('layout-change', syncSoon));

  // Frontmatter edits (type, relations) restyle note cards without waiting for the timer.
  // Canvases in background tabs don't need redrawing; they catch up when shown again.
  const sweepVisible = (): void => {
    for (const controller of controllers.values()) {
      if (controller.view.containerEl.isShown()) controller.sweep();
    }
  };
  plugin.registerEvent(plugin.app.metadataCache.on('changed', debounce(sweepVisible, 300, true)));
  plugin.registerInterval(window.setInterval(sweepVisible, 1000));
  // Issues arrive from Linear a moment after their cards are drawn.
  plugin.register(plugin.linear.store.onUpdate(sweepVisible));

  plugin.register(() => {
    for (const controller of controllers.values()) controller.destroy();
    controllers.clear();
    // The controllers saved their panels as they went: write them now rather than after the plugin is gone.
    panelStore.flush();
  });
}
