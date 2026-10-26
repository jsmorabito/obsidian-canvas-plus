import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chooseDrop, forwardOf, sideOf } from '../src/canvas/drop-zones.ts';

/** A node 100 wide and 40 high with its top left at (x, y). */
const box = (x: number, y: number) => ({ left: x, top: y, right: x + 100, bottom: y + 40 });
const targets = [{ id: 'a', rect: box(0, 0) }, { id: 'b', rect: box(150, 0) }, { id: 'c', rect: box(300, 0) }];
const siblings = new Set(['a', 'b', 'c']);

test('the side of a box the point is nearest to', () => {
  const b = box(0, 0);
  assert.equal(sideOf(b, 50, 2), 'top');
  assert.equal(sideOf(b, 50, 38), 'bottom');
  assert.equal(sideOf(b, 2, 20), 'left');
  assert.equal(sideOf(b, 98, 20), 'right');
});

test('the way a chart runs out of a node, from its source', () => {
  assert.equal(forwardOf('LR'), 'right');
  assert.equal(forwardOf('RL'), 'left');
  assert.equal(forwardOf('TD'), 'bottom');
  assert.equal(forwardOf('TB'), 'bottom');
  assert.equal(forwardOf('BT'), 'top');
  assert.equal(forwardOf('nonsense'), 'bottom');
});

test('top to bottom: below is a child, the sides are before and after, above takes nothing', () => {
  // Over node b, whose middle is (200, 20).
  assert.deepEqual(chooseDrop('bottom', siblings, targets, 200, 38), { id: 'b', place: 'inside', side: 'bottom' });
  assert.deepEqual(chooseDrop('bottom', siblings, targets, 152, 20), { id: 'b', place: 'before', side: 'left' });
  assert.deepEqual(chooseDrop('bottom', siblings, targets, 248, 20), { id: 'b', place: 'after', side: 'right' });
  assert.equal(chooseDrop('bottom', siblings, targets, 200, 2), null);
});

test('left to right: the right is a child, above and below are before and after', () => {
  assert.deepEqual(chooseDrop('right', siblings, targets, 248, 20), { id: 'b', place: 'inside', side: 'right' });
  assert.deepEqual(chooseDrop('right', siblings, targets, 200, 2), { id: 'b', place: 'before', side: 'top' });
  assert.deepEqual(chooseDrop('right', siblings, targets, 200, 38), { id: 'b', place: 'after', side: 'bottom' });
  assert.equal(chooseDrop('right', siblings, targets, 152, 20), null);
});

test('the other two directions are the mirror images', () => {
  assert.deepEqual(chooseDrop('left', siblings, targets, 152, 20), { id: 'b', place: 'inside', side: 'left' });
  assert.equal(chooseDrop('left', siblings, targets, 248, 20), null);
  assert.deepEqual(chooseDrop('top', siblings, targets, 200, 2), { id: 'b', place: 'inside', side: 'top' });
  assert.equal(chooseDrop('top', siblings, targets, 200, 38), null);
  assert.deepEqual(chooseDrop('top', siblings, targets, 152, 20), { id: 'b', place: 'before', side: 'left' });
});

test('a node that is not a sibling is only ever a parent', () => {
  const others = new Set(['a', 'c']);
  assert.deepEqual(chooseDrop('bottom', others, targets, 152, 20), { id: 'b', place: 'inside', side: 'bottom' });
  assert.deepEqual(chooseDrop('right', others, targets, 200, 2), { id: 'b', place: 'inside', side: 'right' });
});

test('in the gaps it goes beside the nearest sibling', () => {
  // Between a and b, nearer to b, with the chart running down: b is to the right, so before b.
  assert.deepEqual(chooseDrop('bottom', siblings, targets, 135, 20), { id: 'b', place: 'before', side: 'left' });
  assert.deepEqual(chooseDrop('bottom', siblings, targets, 118, 20), { id: 'a', place: 'after', side: 'right' });
  // Running across, the gaps are above and below.
  assert.deepEqual(chooseDrop('right', siblings, targets, 200, -30), { id: 'b', place: 'before', side: 'top' });
  assert.deepEqual(chooseDrop('right', siblings, targets, 200, 90), { id: 'b', place: 'after', side: 'bottom' });
  assert.equal(chooseDrop('bottom', new Set(), targets, 135, 20), null, 'no siblings, nowhere to go');
});
