import { CanvasLike, CanvasNodeLike, afterCanvasFrame, batch, draggedNodes, getExtra, nodeBox, patchData } from './adapter.ts';
import { CLICK_SLOP_PX, FIELD_PIN_AT, TARGET_CLASS } from './constants.ts';
import { readInk } from './ink-nodes.ts';
import { trackPointer } from './pointer-session.ts';

/** What a pin is attached to: a node's id, and the pin's top-left from that node's. */
export interface Attach {
  node: string;
  dx: number;
  dy: number;
}

/**
 * Pins being carried, or just let go and not yet attached or detached. Following skips them: core stops marking a pin as dragged
 * the moment it is let go, and before its attachment has changed the pin would be put straight back on the node it was dragged off.
 */
const settling = new WeakSet<CanvasNodeLike>();

/** Each canvas's attached pins by id, as last read: following them on every frame must not read every node's data. */
const attachments = new WeakMap<CanvasLike, Map<string, Attach>>();

/** The attachment a node's data holds, if it is well formed. */
export function readAttach(node: CanvasNodeLike, data?: Record<string, unknown>): Attach | null {
  const v = getExtra(node, FIELD_PIN_AT, data) as Partial<Attach> | undefined;
  return v && typeof v.node === 'string' && Number.isFinite(v.dx) && Number.isFinite(v.dy) ? { node: v.node, dx: v.dx!, dy: v.dy! } : null;
}

/** Remember which pins are attached, as read by a sweep. One whose node has gone is left alone: the pin stays where it was. */
export function setAttachments(canvas: CanvasLike, found: Map<string, Attach>): void {
  attachments.set(canvas, found);
}

/** Whether `node` is attached to `pin`, through any number of pins: attaching `pin` to it would chase its own tail. */
function leadsTo(canvas: CanvasLike, node: CanvasNodeLike, pin: CanvasNodeLike): boolean {
  const seen = new Set<string>();
  let at = attachments.get(canvas)?.get(node.id ?? '');
  while (at && !seen.has(at.node)) {
    if (at.node === pin.id) return true;
    seen.add(at.node);
    at = attachments.get(canvas)?.get(at.node);
  }
  return false;
}

/** The smallest node the middle of `pin` is over that it could attach to: not hidden, not a stroke, not one that is attached to it. */
function targetUnder(canvas: CanvasLike, pin: CanvasNodeLike): CanvasNodeLike | undefined {
  const mine = nodeBox(pin);
  if (!mine) return undefined;
  const x = mine.x + mine.width / 2;
  const y = mine.y + mine.height / 2;
  let best: CanvasNodeLike | undefined;
  let bestArea = Infinity;
  for (const node of canvas.nodes?.values() ?? []) {
    const box = nodeBox(node);
    if (!box || !node.id || node === pin || readInk(node) || node.nodeEl?.hasAttribute('data-ffc-pin-hidden')) continue;
    if (x < box.x || y < box.y || x > box.x + box.width || y > box.y + box.height) continue;
    if (box.width * box.height >= bestArea || leadsTo(canvas, node, pin)) continue;
    best = node;
    bestArea = box.width * box.height;
  }
  return best;
}

/**
 * A pin was pressed on: if it is dragged, the node it is let go over is lit while it is carried, and on release the pin
 * attaches to it (or to none, if let go over empty canvas). `done` runs after the pin's attachment has changed.
 */
export function trackPinDrop(canvas: CanvasLike, pin: CanvasNodeLike, down: PointerEvent, doc: Document, done: () => void): void {
  let moved = false;
  let lit: CanvasNodeLike | undefined;
  const light = (node: CanvasNodeLike | undefined): void => {
    if (node === lit) return;
    lit?.nodeEl?.removeClass(TARGET_CLASS);
    node?.nodeEl?.addClass(TARGET_CLASS);
    lit = node;
  };
  const stop = trackPointer(doc, down.pointerId, {
    move: (e) => {
      if (!moved && Math.hypot(e.clientX - down.clientX, e.clientY - down.clientY) < CLICK_SLOP_PX) return;
      moved = true;
      settling.add(pin);
      light(targetUnder(canvas, pin));
    },
    up: () => {
      stop();
      light(undefined);
      // Once core has finished its drag, so the pin is where it was let go.
      if (!moved) return;
      window.setTimeout(() => {
        try {
          attach(canvas, pin, done);
        } finally {
          settling.delete(pin);
        }
      }, 0);
    },
    cancel: () => {
      stop();
      light(undefined);
      settling.delete(pin);
    },
  });
}

function attach(canvas: CanvasLike, pin: CanvasNodeLike, done: () => void): void {
  const target = targetUnder(canvas, pin);
  const mine = nodeBox(pin);
  const theirs = target && nodeBox(target);
  const next: Attach | null = target?.id && mine && theirs ? { node: target.id, dx: mine.x - theirs.x, dy: mine.y - theirs.y } : null;
  // A pin let go over nothing, that wasn't attached, has nothing to change.
  if (!next && !readAttach(pin)) return;
  batch(canvas, () => patchData(pin, { [FIELD_PIN_AT]: next ?? undefined }));
  // Obsidian keeps fields it doesn't know in a bag of its own: a detached pin must not be read back as attached from there.
  if (!next && pin.unknownData) Reflect.deleteProperty(pin.unknownData, FIELD_PIN_AT);
  const found = attachments.get(canvas) ?? new Map<string, Attach>();
  if (next && pin.id) found.set(pin.id, next);
  else if (pin.id) found.delete(pin.id);
  attachments.set(canvas, found);
  done();
}

/**
 * Keep attached pins on their nodes as the nodes move: on each canvas frame, each is put back at its offset. Not the ones being
 * dragged, which are where the pointer has put them. Not an undo step: undoing a move of the node puts the pin back with it.
 */
export function watchPinAttach(canvas: CanvasLike): () => void {
  const follow = (): void => {
    const found = attachments.get(canvas);
    if (!found || found.size === 0) return;
    const dragged = new Set(draggedNodes(canvas));
    let moved = false;
    for (const [id, at] of found) {
      const pin = canvas.nodes?.get(id);
      const target = canvas.nodes?.get(at.node);
      const mine = pin && nodeBox(pin);
      const theirs = target && nodeBox(target);
      if (!pin || !mine || !theirs || dragged.has(pin) || settling.has(pin)) continue;
      const x = theirs.x + at.dx;
      const y = theirs.y + at.dy;
      if (Math.abs(mine.x - x) < 0.5 && Math.abs(mine.y - y) < 0.5) continue;
      pin.moveAndResize?.({ ...mine, x, y });
      moved = true;
    }
    if (moved) canvas.requestSave?.(false);
  };
  const stop = afterCanvasFrame(canvas, follow);
  return () => {
    stop();
    attachments.delete(canvas);
  };
}
