import assert from 'node:assert/strict';
import { test } from 'node:test';
import { holderOf, splitByHolder } from '../src/canvas/holder.ts';

test('the tray is where a thing is held unless it says dock', () => {
  assert.equal(holderOf(undefined), 'tray');
  assert.equal(holderOf('tray'), 'tray');
  assert.equal(holderOf('dock'), 'dock');
});

test('an unknown holder counts as the tray, so the thing never goes missing', () => {
  assert.equal(holderOf('sidebar'), 'tray');
  assert.equal(holderOf(42), 'tray');
  assert.equal(holderOf(null), 'tray');
});

test('a list splits by holder, keeping its order and losing nothing', () => {
  const list = [{ id: 'a' }, { id: 'b', holder: 'dock' }, { id: 'c', holder: 'tray' }, { id: 'd', holder: 'x' }, { id: 'e', holder: 'dock' }];
  const { tray, dock } = splitByHolder(list);
  assert.deepEqual(tray.map((t) => t.id), ['a', 'c', 'd']);
  assert.deepEqual(dock.map((t) => t.id), ['b', 'e']);
  assert.equal(tray.length + dock.length, list.length);
});
