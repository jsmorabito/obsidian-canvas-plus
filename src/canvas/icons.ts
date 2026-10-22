import { addIcon, removeIcon } from 'obsidian';

/** Icon id for note types: a page with frontmatter lines (frontmatter.svg). */
export const NOTE_TYPES_ICON = 'ffc-note-types';
/** Icon id for Linear: its app icon, a dark rounded square with the white mark, as Figma lists it. In colour, so it doesn't follow the theme. */
export const LINEAR_ICON = 'ffc-linear';
/** Icon for the actions panel button: Lucide's command (⌘), after the shortcut that opens it. Obsidian bundles it. */
export const ACTIONS_ICON = 'command';
/** Icon id for adding a tab panel: Lucide's file-plus-corner with the dog-ear rounded off like the other corners. */
export const PANEL_ICON = 'ffc-panel-add';
/** Icon id for presenting a canvas: Lucide's presentation, which Obsidian doesn't bundle. */
export const PRESENT_ICON = 'ffc-presentation';

/** Each icon's paths, drawn on a 24 x 24 grid. */
const ICONS: Record<string, string[]> = {
  [NOTE_TYPES_ICON]: [
    'M6 22C5.46957 22 4.96086 21.7893 4.58579 21.4142C4.21071 21.0391 4 20.5304 4 20V4C4 3.46957 4.21071 2.96086 4.58579 2.58579C4.96086 2.21071 5.46957 2 6 2H14C14.3166 1.99949 14.6301 2.0616 14.9225 2.18277C15.215 2.30393 15.4806 2.48176 15.704 2.706L19.292 6.294C19.5168 6.51751 19.6952 6.78334 19.8167 7.07616C19.9382 7.36898 20.0005 7.68297 20 8V20C20 20.5304 19.7893 21.0391 19.4142 21.4142C19.0391 21.7893 18.5304 22 18 22H6Z',
    'M14 2V7C14 7.26522 14.1054 7.51957 14.2929 7.70711C14.4804 7.89464 14.7348 8 15 8H20',
    'M9 13H8', 'M9 17H8', 'M12.5 13H11.5', 'M12.5 17H11.5', 'M16 13H15', 'M16 17H15',
  ],
  [PANEL_ICON]: [
    'M11.35 22H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9.35',
    'M14 19h6', 'M17 16v6',
  ],
  [PRESENT_ICON]: ['M2 3h20', 'M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3', 'm7 21 5-5 5 5'],
};

/** Linear's mark, on a 24 x 24 grid. */
const LINEAR_MARK = 'M2.886 4.18A11.982 11.982 0 0 1 11.99 0C18.624 0 24 5.376 24 12.009c0 3.64-1.62 6.903-4.18 9.105L2.887 4.18ZM1.817 5.626l16.556 16.556c-.524.33-1.075.62-1.65.866L.951 7.277c.247-.575.537-1.126.866-1.65ZM.322 9.163l14.515 14.515c-.71.172-1.443.282-2.195.322L0 11.358a12 12 0 0 1 .322-2.195Zm-.17 4.862 9.823 9.824a12.02 12.02 0 0 1-9.824-9.824Z';

/** Icons with colours of their own, drawn on Obsidian's 100 x 100 grid. Fill and stroke are set on each shape, as the icon's root sets a stroke. */
const COLOR_ICONS: Record<string, string> = {
  // The mark at 60% in the middle of the tile.
  [LINEAR_ICON]: '<rect width="100" height="100" rx="22" fill="#222326" stroke="none"/>'
    + `<path transform="translate(20 20) scale(${60 / 24})" d="${LINEAR_MARK}" fill="#fff" stroke="none"/>`,
};

/**
 * Obsidian draws custom icons on a 100 x 100 grid, so scale the 24 x 24 paths
 * up. The line weight comes from `--icon-stroke`, so it matches the built-in
 * icons at every size and in every theme. The fill is `--ffc-icon-fill`, hollow unless a
 * place sets it (the canvas card menu fills its icons with the page colour, as core does).
 */
function content(paths: string[]): string {
  return `<g transform="scale(${100 / 24})" stroke="currentColor" stroke-linecap="round" `
    + `stroke-linejoin="round" style="stroke-width: var(--icon-stroke, 2px); fill: var(--ffc-icon-fill, none)">`
    + paths.map((d) => `<path d="${d}"/>`).join('')
    + '</g>';
}

/** Register the icons; returns a function that removes them again (for plugin unload). */
export function registerIcons(): () => void {
  for (const [id, paths] of Object.entries(ICONS)) addIcon(id, content(paths));
  for (const [id, svg] of Object.entries(COLOR_ICONS)) addIcon(id, svg);
  return () => { for (const id of [...Object.keys(ICONS), ...Object.keys(COLOR_ICONS)]) removeIcon(id); };
}
