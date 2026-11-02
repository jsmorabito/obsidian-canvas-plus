import { PROVIDERS } from '../issues/providers.ts';
import type { CanvasPlusPlugin } from '../main.ts';
import type { DiagramHeld } from './diagram-data.ts';
import { IssueRef, readIssueRef } from './issue-ref.ts';
import { CardFacts, factsOf, metaFor, priorityBar, shortName } from './kanban-facts.ts';
import { refLabel } from './ref-label.ts';
import type { Marker } from './status-marker.ts';
import type { TrayItem } from './tray-items.ts';

/** The issue, project or initiative a held canvas card shows, or null when it is something else. */
export function refOfHeld(item: TrayItem): IssueRef | null {
  const data = item.nodes[0];
  return data ? readIssueRef({}, data) : null;
}

/** The data a board's card is written with for the issue, project or initiative it holds: its service's icon, and what it says until the service answers. */
export function heldMeta(item: TrayItem): string {
  const ref = refOfHeld(item);
  return ref ? metaFor((ref.kind === 'issue' && ref.identifier) || refLabel(ref.kind), PROVIDERS[ref.provider].icon) : '';
}

/** Space the card's text keeps from its edge, in the drawing's own units (Pele's own). */
const PAD = 10;
/** The status marker's radius, so it is 12 across as the canvas card's is, and the space between it and the text. */
const MARKER_RADIUS = 6;
const MARKER_GAP = 6;
/** Space that keeps the assignee off the text beside it. */
const NAME_GAP = 8;
const PROGRESS_HEIGHT = 3;
const PROGRESS_FROM_BOTTOM = 8;
/** Set on a drawn card to what it was last painted from. Pele draws a fresh card when it redraws, which has none. */
const PAINTED_ATTR = 'data-ffc-painted';

/**
 * Fill in what the cards of a drawn board say about what they hold, from what the services have returned: the status
 * or id under the title, who it is with on the right, and a bar for the priority. `ids` are the ids of the board's
 * cards in the order they are drawn. Idempotent, so safe to run on every sweep; asks the services for what isn't loaded.
 */
export function paintHeld(plugin: CanvasPlusPlugin, host: HTMLElement, ids: readonly string[], held: DiagramHeld | undefined): void {
  if (!held) return;
  const cards = host.querySelectorAll<SVGGElement>('.pele-card');
  ids.forEach((id, n) => {
    const item = held[id];
    const ref = item && refOfHeld(item);
    if (!ref || !cards[n]) return;
    plugin.storeFor(ref).request(ref.id);
    paintCard(cards[n], factsOf(plugin.itemOf(ref)));
  });
}

function paintCard(card: SVGGElement, facts: CardFacts): void {
  const rect = card.querySelector('rect');
  const width = Number(rect?.getAttribute('width'));
  const height = Number(rect?.getAttribute('height'));
  // Drawn again only when what it says or its size has changed: every sweep comes here, and measuring forces a layout.
  const key = JSON.stringify([facts, width, height]);
  if (card.getAttribute(PAINTED_ATTR) === key) return;
  card.setAttribute(PAINTED_ATTR, key);
  const ticket = card.querySelector('.pele-ticket');
  if (ticket && facts.ticket && ticket.textContent !== facts.ticket) ticket.textContent = facts.ticket;
  const line = Number(ticket?.getAttribute('y'));

  // The marker takes the room before the text, as it does on the canvas card.
  const marker = ticket && facts.marker && line > 0 ? facts.marker : null;
  ticket?.setAttribute('x', String(marker ? PAD + 2 * MARKER_RADIUS + MARKER_GAP : PAD));
  paintMarker(card, marker, line);

  // Pele makes room for a line under the title only for a ticket, so who it is with goes on that line, at the other end.
  let who = card.querySelector('.ffc-kb-assigned');
  const name = facts.assigned ? shortName(facts.assigned) : '';
  if (ticket && name && width > 0) {
    who ??= card.createSvg('text', { cls: 'pele-assigned ffc-kb-assigned', attr: { fill: 'var(--_m)', 'text-anchor': 'end' } });
    who.setAttribute('x', String(width - PAD));
    who.setAttribute('y', ticket.getAttribute('y') ?? '0');
    if (who.textContent !== name) who.textContent = name;
    // On a narrow column the name would run over the text beside it: the text is the more useful of the two.
    const left = (who as SVGGraphicsElement).getBBox?.().x ?? 0;
    const right = (ticket as SVGGraphicsElement).getBBox?.();
    if (right && right.width > 0 && right.x + right.width + NAME_GAP > left) who.remove();
  } else who?.remove();

  let bar = card.querySelector('.ffc-kb-priority');
  const look = priorityBar(facts.priority);
  if (rect && look && height > 0) {
    if (!bar) {
      bar = card.createSvg('path', { cls: 'pele-priority ffc-kb-priority', attr: { fill: 'none', 'stroke-width': '3', 'stroke-linecap': 'round' } });
      rect.after(bar);
    }
    bar.setAttribute('d', `M2.5,5V${height - 5}`);
    bar.setAttribute('stroke', look.stroke);
    bar.setAttribute('opacity', look.opacity);
  } else bar?.remove();

  paintProgress(card, facts.progress, marker, width, height);
}

/** A colour the service gave, or the faint text colour where it gave none or one that isn't a hex colour. */
function colourOf(color: string | undefined): string {
  return color && /^#[0-9a-f]{3,8}$/i.test(color) ? color : 'var(--text-faint)';
}

/**
 * The status marker the canvas card has, drawn beside the line under the title: a ring for not started (dashed in
 * the backlog), half full once started, full when done, in the status's colour. Drawn again only when it changes.
 */
function paintMarker(card: SVGGElement, marker: Marker | null, line: number): void {
  let mark = card.querySelector('.ffc-kb-state');
  if (!marker) {
    mark?.remove();
    return;
  }
  const key = `${marker.type}|${marker.color}`;
  mark ??= card.createSvg('g', { cls: 'ffc-kb-state' });
  mark.setAttribute('transform', `translate(${PAD + MARKER_RADIUS} ${line - 5})`);
  if (mark.getAttribute('data-ffc-key') === key) return;
  mark.setAttribute('data-ffc-key', key);
  mark.empty();
  const colour = colourOf(marker.color);
  const r = MARKER_RADIUS;
  if (marker.type === 'completed' || marker.type === 'canceled') {
    mark.createSvg('circle', { attr: { r, fill: colour } });
    return;
  }
  const ring = mark.createSvg('circle', { attr: { r: r - 1, fill: 'none', stroke: colour, 'stroke-width': 2 } });
  if (marker.type === 'backlog' || marker.type === 'triage') ring.setAttribute('stroke-dasharray', '2 2');
  if (marker.type === 'started') mark.createSvg('path', { attr: { d: `M0,${-r}A${r},${r} 0 0 1 0,${r}Z`, fill: colour } });
}

/** A project's progress as a thin bar along the bottom of its card, filled as far as it has got, in the status's colour. */
function paintProgress(card: SVGGElement, progress: number | undefined, marker: Marker | null, width: number, height: number): void {
  let bar = card.querySelector('.ffc-kb-progress');
  if (progress === undefined || !(width > 0) || !(height > 0)) {
    bar?.remove();
    return;
  }
  const full = width - 2 * PAD;
  const y = height - PROGRESS_FROM_BOTTOM;
  const colour = colourOf(marker?.color);
  if (!bar) {
    bar = card.createSvg('g', { cls: 'ffc-kb-progress' });
    bar.createSvg('rect', { cls: 'ffc-kb-progress-track', attr: { rx: PROGRESS_HEIGHT / 2, height: PROGRESS_HEIGHT, fill: colour, opacity: 0.2 } });
    bar.createSvg('rect', { cls: 'ffc-kb-progress-fill', attr: { rx: PROGRESS_HEIGHT / 2, height: PROGRESS_HEIGHT, fill: colour } });
  }
  const [track, fill] = Array.from(bar.children);
  track.setAttribute('x', String(PAD));
  track.setAttribute('y', String(y));
  track.setAttribute('width', String(full));
  track.setAttribute('fill', colour);
  fill.setAttribute('x', String(PAD));
  fill.setAttribute('y', String(y));
  fill.setAttribute('width', String(Math.max(0, Math.min(1, progress)) * full));
  fill.setAttribute('fill', colour);
}
