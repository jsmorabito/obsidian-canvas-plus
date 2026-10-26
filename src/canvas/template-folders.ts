import type { App } from 'obsidian';

/** Template folders (core Templates and Templater), whose notes are scaffolding rather than notes to relate or add. */
export function templateFolders(app: App): string[] {
  const internals = app as unknown as {
    internalPlugins?: { getPluginById?(id: string): { instance?: { options?: { folder?: string } } } | undefined };
    plugins?: { plugins?: Record<string, { settings?: { templates_folder?: string } } | undefined> };
  };
  const folders = [
    internals.internalPlugins?.getPluginById?.('templates')?.instance?.options?.folder,
    internals.plugins?.plugins?.['templater-obsidian']?.settings?.templates_folder,
  ];
  return folders.filter((f): f is string => typeof f === 'string').map((f) => f.replace(/^\/+|\/+$/g, '')).filter(Boolean);
}
