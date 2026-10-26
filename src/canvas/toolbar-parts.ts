import { App, Menu, setIcon } from 'obsidian';
import type { ProviderId } from '../issues/types.ts';
import type { CanvasPlusPlugin } from '../main.ts';
import { PRESET_HEX } from './constants.ts';
import type { TypeSource } from './convert-card.ts';
import { IconPicker } from './icon-picker.ts';
import { DG_NODE_ICON, LINEAR_ICON, NOTE_TYPES_ICON, TASKAPP_ICON } from './icons.ts';
import { TEXT_FORMATS, TextFormat } from './mindmap-format.ts';
import { NODE_COLORS, NodeColor } from './node-colors.ts';

/** The buttons a diagram's node toolbar is made of, which don't depend on the kind of diagram. */

export function toolButton(bar: HTMLElement, label: string): HTMLButtonElement {
  const button = bar.createEl('button', { cls: 'ffc-mm-tool clickable-icon', attr: { 'aria-label': label, 'data-tooltip-position': 'top', type: 'button' } });
  button.addEventListener('pointerdown', (e) => e.stopPropagation());
  return button;
}

export interface ColorOptions {
  chosen: NodeColor | null;
  /** Given, a checkbox offers to colour what is under the node too. */
  branch?: { get: () => boolean; set: (on: boolean) => void };
  pick: (color: NodeColor | null) => void;
}

/** A swatch of the node's colour, which opens the colours to pick from. */
export function addColorButton(bar: HTMLElement, { chosen, branch, pick }: ColorOptions): void {
  const button = toolButton(bar, 'Color');
  if (chosen?.startsWith('#')) {
    button.createSpan({ cls: 'ffc-mm-swatch is-custom' }).setCssProps({ '--ffc-mm-color': chosen });
  } else if (chosen) button.createSpan({ cls: `ffc-mm-swatch ffc-c-${chosen}` });
  else setIcon(button, 'palette');
  button.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = bar.querySelector('.ffc-mm-pop');
    if (open) {
      open.remove();
      return;
    }
    // The canvas's own colour picker markup, so it is drawn by core's styles.
    const pop = bar.createDiv({ cls: 'ffc-mm-pop is-colors' });
    const row = pop.createDiv({ cls: 'canvas-submenu ffc-mm-submenu' });
    const item = (label: string, color: NodeColor | null, n: number): void => {
      const swatch = row.createDiv({
        cls: `canvas-color-picker-item${n > 0 ? ` mod-canvas-color-${n}` : ''}`,
        attr: { 'aria-label': label, 'data-tooltip-position': 'top' },
      });
      if (color === chosen) swatch.addClass('is-active');
      swatch.addEventListener('click', () => pick(color));
    };
    item('No color', null, 0);
    NODE_COLORS.forEach((color, n) => item(color[0].toUpperCase() + color.slice(1), color, n + 1));
    // Any colour, from the system's picker, as the canvas's own has.
    const custom = row.createDiv({ cls: 'canvas-color-picker-item canvas-color-picker-custom', attr: { 'aria-label': 'Custom color', 'data-tooltip-position': 'top' } });
    const field = custom.createEl('input', { attr: { type: 'color' } });
    // Opens on the canvas's purple, the last of its own colours.
    field.value = chosen?.startsWith('#') ? chosen : PRESET_HEX['6'];
    if (chosen?.startsWith('#')) custom.addClass('is-active');
    field.addEventListener('change', () => pick(field.value as NodeColor));
    if (branch) {
      const label = pop.createDiv({ cls: 'canvas-submenu ffc-mm-submenu' }).createEl('label', { cls: 'ffc-mm-branch' });
      const box = label.createEl('input', { attr: { type: 'checkbox' } });
      box.checked = branch.get();
      box.addEventListener('change', () => branch.set(box.checked));
      label.createSpan({ text: 'Include children' });
    }
    pop.addEventListener('pointerdown', (ev) => ev.stopPropagation());
  });
}

export interface ShapeOption<T extends string> {
  id: T;
  label: string;
}

/** The shapes icon, which opens a menu of the shapes, the current one checked. */
export function addShapeButton<T extends string>(bar: HTMLElement, shapes: ReadonlyArray<ShapeOption<T>>, current: T, pick: (shape: T) => void): void {
  const button = toolButton(bar, 'Shape');
  setIcon(button, 'shapes');
  button.addEventListener('click', (e) => {
    e.stopPropagation();
    const menu = new Menu();
    for (const option of shapes) {
      menu.addItem((item) => item.setTitle(option.label).setChecked(option.id === current).onClick(() => pick(option.id)));
    }
    const rect = button.getBoundingClientRect();
    menu.showAtPosition({ x: rect.left, y: rect.bottom + 4 });
  });
}

/** The node's icon, which opens a search over Obsidian's icons, as Commander's does. */
export function addIconButton(bar: HTMLElement, app: App, chosen: string | null, pick: (name: string | null) => void): void {
  const button = toolButton(bar, 'Icon');
  setIcon(button, chosen ?? 'smile');
  button.addEventListener('click', (e) => {
    e.stopPropagation();
    new IconPicker(app, chosen, pick).open();
  });
}

/** Bold, italic and the rest, for all of the node's text. A button is lit when the text has that format. */
export function addFormatButtons(
  bar: HTMLElement, isOn: (format: TextFormat) => boolean, toggle: (format: TextFormat) => void, formats: readonly TextFormat[] = TEXT_FORMATS,
): void {
  for (const format of formats) {
    const button = toolButton(bar, format.label);
    setIcon(button, format.icon);
    if (isOn(format)) button.addClass('is-active');
    button.addEventListener('click', (e) => {
      e.stopPropagation();
      toggle(format);
    });
  }
}

/** A button that asks for a web address the node's text opens. It is lit when the node already has one. */
export function addLinkButton(bar: HTMLElement, isOn: boolean, run: () => void): void {
  const button = toolButton(bar, 'Link to web address');
  setIcon(button, 'link');
  if (isOn) button.addClass('is-active');
  button.addEventListener('click', (e) => {
    e.stopPropagation();
    run();
  });
}

export interface CreateActions {
  note: (source: TypeSource) => void;
  issue: (provider: ProviderId) => void;
}

/** The buttons for the plugins that are on: make a note, a discourse node or an issue from the node's text. */
export function addCreateButtons(bar: HTMLElement, plugin: CanvasPlusPlugin, actions: CreateActions): void {
  const add = (label: string, icon: string, run: () => void): void => {
    const button = toolButton(bar, label);
    setIcon(button, icon);
    button.addEventListener('click', (e) => {
      e.stopPropagation();
      run();
    });
  };
  if (plugin.hasNoteTypes) add('Convert to…', NOTE_TYPES_ICON, () => actions.note('notes'));
  if (plugin.hasDiscourseGraphs) add('Convert to discourse node…', DG_NODE_ICON, () => actions.note('discourse'));
  if (plugin.hasIssues('linear')) add('Create Linear issue', LINEAR_ICON, () => actions.issue('linear'));
  if (plugin.hasIssues('taskapp')) add('Create Task App issue', TASKAPP_ICON, () => actions.issue('taskapp'));
}
