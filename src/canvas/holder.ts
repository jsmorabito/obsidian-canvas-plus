/** The places a thing can be put away: the tray above the toolbar, and the dock under the right-hand buttons. */
export type Holder = 'tray' | 'dock';

/** Where a thing is held. The tray is the default, so a missing or unknown value (a newer or hand-edited file) means the tray. */
export function holderOf(value: unknown): Holder {
  return value === 'dock' ? 'dock' : 'tray';
}

/** A list split by where each thing is held, each part in the list's own order. */
export function splitByHolder<T extends { holder?: unknown }>(list: readonly T[]): Record<Holder, T[]> {
  return {
    tray: list.filter((t) => holderOf(t.holder) === 'tray'),
    dock: list.filter((t) => holderOf(t.holder) === 'dock'),
  };
}
