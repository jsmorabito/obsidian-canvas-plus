import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FIELD_CARD_SIZE, FIELD_EMBED_SIZE, FIELD_VIEW, SIZE_ISSUE_CARD, SIZE_NOTE_CARD } from '../src/canvas/constants.ts';
import { settleToCard } from '../src/canvas/pin-size.ts';

const box = { width: 500, height: 300 };
const card = { width: 260, height: 120 };

test('a card is pinned as it is, and gives its own size back', () => {
  assert.deepEqual(settleToCard('card', false, box, { card: null }), { size: box, patch: {} });
});

test('a note in the link view goes back to its card, with the card size it kept', () => {
  const { size, patch } = settleToCard('link', false, { width: 90, height: 24 }, { card });
  assert.deepEqual(size, card);
  assert.deepEqual(patch, { [FIELD_VIEW]: undefined, [FIELD_CARD_SIZE]: undefined });
});

test('a note in the link view with no kept size gets the standard card', () => {
  assert.deepEqual(settleToCard('link', false, { width: 90, height: 24 }, { card: null }).size, SIZE_NOTE_CARD);
});

test('a note in the embed view shares its box with the card, so the box is what comes back', () => {
  const { size, patch } = settleToCard('embed', false, box, { card: null });
  assert.deepEqual(size, box);
  assert.deepEqual(patch, { [FIELD_VIEW]: undefined });
});

test('an issue in the embed view keeps the embed size and gives the card size back', () => {
  const { size, patch } = settleToCard('embed', true, box, { card });
  assert.deepEqual(size, card);
  assert.deepEqual(patch, { [FIELD_VIEW]: undefined, [FIELD_EMBED_SIZE]: box });
});

test('an issue with no kept card size gets the standard issue card', () => {
  assert.deepEqual(settleToCard('link', true, { width: 90, height: 24 }, { card: null }).size, SIZE_ISSUE_CARD);
});
