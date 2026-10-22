import { setIcon } from 'obsidian';

/**
 * Put an icon in a view's header, before its title, whether or not core drew an icon slot there.
 * Returns whether the header exists yet (it may be built a frame after the view opens), so it can be retried.
 */
export function showHeaderIcon(containerEl: HTMLElement, icon: string): boolean {
  const header = containerEl.querySelector<HTMLElement>(':scope > .view-header');
  if (!header) return false;
  let slot = header.querySelector<HTMLElement>('.view-header-icon');
  if (slot?.dataset.ffcIcon === icon) return true;
  if (!slot) {
    slot = createDiv({ cls: 'view-header-icon' });
    const title = header.querySelector('.view-header-title-container');
    if (title) title.before(slot);
    else header.prepend(slot);
  }
  slot.addClass('ffc-header-icon');
  slot.dataset.ffcIcon = icon;
  slot.empty();
  setIcon(slot, icon);
  return true;
}
