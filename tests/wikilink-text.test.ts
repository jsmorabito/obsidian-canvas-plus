import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TextPart, stripWikilinks } from '../src/canvas/wikilink-text.ts';

/** Lines as Pele draws wrapped text: a part to a line. */
const lines = (...texts: string[]): TextPart[] => texts.map((text) => ({ text, lineStart: true }));

test('a link on one line shows its name', () => {
  assert.deepEqual(stripWikilinks(lines('see [[Note]] here')), { texts: ['see Note here'], target: 'Note' });
});

test('an alias is what shows, and the note is the target', () => {
  assert.deepEqual(stripWikilinks(lines('[[Some note|the note]]')), { texts: ['the note'], target: 'Some note' });
});

test('a link that wraps loses its brackets from both lines', () => {
  const found = stripWikilinks(lines('[[Roam: Initial advanced', 'search]]'));
  assert.deepEqual(found, { texts: ['Roam: Initial advanced', 'search'], target: 'Roam: Initial advanced search' });
});

test('an alias that wraps keeps only the alias', () => {
  const found = stripWikilinks(lines('[[ENG-12|Fix the long', 'running sync]] now'));
  assert.deepEqual(found, { texts: ['Fix the long', 'running sync now'], target: 'ENG-12' });
});

test('a mindmap link is read the same way', () => {
  assert.deepEqual(stripWikilinks(lines('⟦Note|alias⟧ and ⟦Other⟧')), { texts: ['alias and Other'], target: 'Note' });
});

test('parts of one line join without a space', () => {
  const parts: TextPart[] = [{ text: '[[No', lineStart: true }, { text: 'te]]', lineStart: false }];
  assert.deepEqual(stripWikilinks(parts), { texts: ['No', 'te'], target: 'Note' });
});

test('text without a link is left as it is', () => {
  assert.deepEqual(stripWikilinks(lines('plain', 'words')), { texts: ['plain', 'words'], target: null });
});
