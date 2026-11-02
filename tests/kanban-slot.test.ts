import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SlotBox, SlotColumn, chooseSlot } from '../src/canvas/kanban-slot.ts';

const box = (left: number, top: number, right: number, bottom: number): SlotBox => ({ left, top, right, bottom });

/** Three columns 200 wide with 10 between, cards 40 tall from y = 40 with 8 between. */
function board(): SlotColumn[] {
  const column = (i: number, cards: number[]): SlotColumn => ({
    i,
    rect: box(i * 210, 0, i * 210 + 200, 200),
    headerBottom: 30,
    cards: cards.map((c, n) => ({ i: c, rect: box(i * 210 + 8, 40 + n * 48, i * 210 + 192, 80 + n * 48) })),
  });
  return [column(0, [0, 1]), column(1, [2]), column(2, [])];
}

test('a point goes in the column it is over, above the first card whose middle is below it', () => {
  const columns = board();
  const top = chooseSlot(columns, 50, 45, 1);
  assert.equal(top?.column.i, 0);
  assert.equal(top?.before, 0);
  assert.equal(top?.edge, 36);
  const between = chooseSlot(columns, 50, 90, 1);
  assert.equal(between?.before, 1);
  assert.equal(between?.edge, 84);
});

test('below every card it goes at the bottom, with the line under the last one', () => {
  const slot = chooseSlot(board(), 50, 190, 1);
  assert.equal(slot?.before, undefined);
  assert.equal(slot?.edge, 132);
});

test('an empty column takes it under its title', () => {
  const slot = chooseSlot(board(), 450, 100, 1);
  assert.equal(slot?.column.i, 2);
  assert.equal(slot?.before, undefined);
  assert.equal(slot?.edge, 34);
});

test('beside the columns it goes in the nearest one', () => {
  const columns = board();
  assert.equal(chooseSlot(columns, -100, 100, 1)?.column.i, 0);
  assert.equal(chooseSlot(columns, 1000, 100, 1)?.column.i, 2);
  // In the gap, the nearer of the two.
  assert.equal(chooseSlot(columns, 203, 100, 1)?.column.i, 0);
  assert.equal(chooseSlot(columns, 207, 100, 1)?.column.i, 1);
});

test('the line sits half a gap from the card, in screen pixels', () => {
  const slot = chooseSlot(board(), 50, 45, 2);
  assert.equal(slot?.edge, 32);
});

test('no columns, no slot', () => {
  assert.equal(chooseSlot([], 0, 0, 1), null);
});
