import { Component, Plugin, TFile } from 'obsidian';
import { HTML_EXTENSIONS, mountHtmlFrame } from './frame.ts';

interface EmbedContext {
  app: Plugin['app'];
  containerEl: HTMLElement;
}

type EmbedCreator = (ctx: EmbedContext, file: TFile) => Component;

interface EmbedRegistry {
  registerExtensions: (extensions: string[], creator: EmbedCreator) => void;
  unregisterExtensions: (extensions: string[]) => void;
  embedByExtension?: Record<string, EmbedCreator>;
}

/** Let HTML files be embedded: canvas file nodes, and `![[page.html]]` in notes, show the rendered page. Relies on an internal registry. */
export function registerHtmlEmbed(plugin: Plugin): void {
  const registry = (plugin.app as unknown as { embedRegistry?: EmbedRegistry }).embedRegistry;
  if (!registry?.registerExtensions) return;
  // What was there before, so unloading puts it back rather than leaving another plugin's embed gone.
  const previous = HTML_EXTENSIONS.map((ext) => [ext, registry.embedByExtension?.[ext]] as const);
  registry.registerExtensions(HTML_EXTENSIONS, (ctx, file) => {
    const embed = new Component() as Component & { loadFile: () => Promise<void> };
    let reload: (() => Promise<void>) | null = null;
    embed.onload = () => {
      ctx.containerEl.addClass('ffc-html-embed');
      const mounted = mountHtmlFrame(ctx.app, ctx.containerEl, file);
      reload = mounted.reload;
      embed.register(() => mounted.frame.remove());
      embed.registerEvent(ctx.app.vault.on('modify', (changed) => {
        if (changed === file) void reload?.();
      }));
    };
    embed.loadFile = () => reload?.() ?? Promise.resolve();
    return embed;
  });
  plugin.register(() => {
    registry.unregisterExtensions?.(HTML_EXTENSIONS);
    for (const [ext, creator] of previous) if (creator) registry.registerExtensions([ext], creator);
  });
}
