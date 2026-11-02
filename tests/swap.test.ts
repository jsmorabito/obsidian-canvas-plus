import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Placed, centredOn, placedAt, swapMoves } from '../src/canvas/swap.ts';

const at = (node: string, x: number, y: number, width: number, height: number, group = false): Placed<string> => ({ node, box: { x, y, width, height }, group });

test('the smallest node under the point is the target, so a card in a group beats the group', () => {
  const group = at('g', 0, 0, 500, 500, true);
  const card = at('c', 100, 100, 50, 50);
  assert.equal(placedAt([group, card], { x: 120, y: 120 })?.node, 'c');
  assert.equal(placedAt([card, group], { x: 120, y: 120 })?.node, 'c');
  assert.equal(placedAt([group, card], { x: 300, y: 300 })?.node, 'g');
  assert.equal(placedAt([group, card], { x: 900, y: 900 }), undefined);
});

test('a swap puts each centre where the other was, keeping sizes', () => {
  const moves = swapMoves(at('a', 0, 0, 100, 100), at('b', 300, 0, 50, 50), []);
  assert.deepEqual(moves[0].box, { x: 275, y: -25, width: 100, height: 100 });
  assert.deepEqual(moves[1].box, { x: 25, y: 25, width: 50, height: 50 });
  assert.deepEqual(centredOn(moves[0].box, at('a', 0, 0, 100, 100).box), { x: 0, y: 0, width: 100, height: 100 });
});

test('a group takes the nodes inside it along, but not ones it does not hold or ones being swapped', () => {
  const group = at('g', 0, 0, 200, 200, true);
  const inside = at('in', 10, 10, 20, 20);
  const outside = at('out', 150, 150, 100, 100);
  const moves = swapMoves(group, at('b', 400, 0, 200, 200), [inside, outside, group]);
  assert.deepEqual(moves.map((m) => m.node), ['g', 'b', 'in']);
  assert.deepEqual(moves[2].box, { x: 410, y: 10, width: 20, height: 20 });
});
