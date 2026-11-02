import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parse, render } from 'pele';
import {
  Edit, Kanban, Pick, addCard, addCardBefore, addCards, addColumn, labelOf, moveCard, moveColumn, neighbour, readKanban, remove, rename, shift,
} from '../src/canvas/kanban-edit.ts';
import { metaFor } from '../src/canvas/kanban-facts.ts';

const BASE = 'kanban\n  Todo\n    Write\n    Test\n  Doing\n    Build\n  Done';

function read(source: string): Kanban {
  const k = readKanban(source);
  assert.ok(k, `should be a kanban:\n${source}`);
  return k;
}

/** The board as Pele reads it: each column with its cards. */
function board(source: string): string[][] {
  const model = parse(source);
  assert.equal(model.type, 'kanban');
  return model.sections.map((s) => [s.label, ...s.items.map((i) => i.label)]);
}

/** An edit, checked: Pele can draw what it wrote, and the pick is at the node it says. */
function checked(edit: Edit | null, label?: string): Edit {
  assert.ok(edit, 'should have changed the source');
  assert.doesNotThrow(() => render(edit.source), edit.source);
  const k = read(edit.source);
  if (label !== undefined) assert.equal(labelOf(k, edit.pick), label, edit.source);
  return edit;
}

test('reads columns and cards in the order Pele has them', () => {
  const k = read(BASE);
  assert.deepEqual(k.columns.map((c) => c.label), ['Todo', 'Doing', 'Done']);
  assert.deepEqual(k.cards.map((c) => [c.label, c.column]), [['Write', 0], ['Test', 0], ['Build', 1]]);
  assert.deepEqual(k.columns.map((c) => c.cards), [[0, 1], [2], []]);
});

test('refuses what is not an editable kanban', () => {
  assert.equal(readKanban('flowchart LR\n  A --> B'), null);
  assert.equal(readKanban('kanban'), null);
  assert.equal(readKanban('kanban\n  A\n    @bad'), null);
  assert.equal(readKanban('kanban\n\tA\n\t\tc'), null);
});

test('reads ids, brackets, data, comments and front matter', () => {
  const source = '---\ntitle: Plan\n---\nkanban\n  %% note\n  todo[To do]\n    t1[Write the spec]@{ ticket: MC-1, assigned: "jo" }\n    ::icon(lucide-book)\n    Plain@{ priority: "High" }\n\n  doing(Doing)';
  const k = read(source);
  assert.deepEqual(k.columns.map((c) => c.label), ['To do', 'Doing']);
  assert.deepEqual(k.cards.map((c) => c.label), ['Write the spec', 'Plain']);
  // The icon line goes with the card above it.
  assert.equal(k.cards[0].end - k.cards[0].line, 1);
});

test('reads text in brackets the way Pele does', () => {
  const k = read('kanban\n  A\n    Fix (soon)\n    x["Fix [bug] (now)"]');
  assert.deepEqual(k.cards.map((c) => c.label), ['soon', 'Fix [bug] (now)']);
});

test('keeps quotes on text that stands alone', () => {
  const k = read('kanban\n  A\n    "just quoted"');
  assert.equal(k.cards[0].label, '"just quoted"');
});

test('renames a card or a column, keeping its id, data and indent', () => {
  const source = 'kanban\n  todo[To do]\n    t1[Write]@{ ticket: MC-1 }\n    Plain@{ priority: "High" }';
  const k = read(source);
  const card = checked(rename(k, { kind: 'card', i: 0 }, 'Draft'), 'Draft');
  assert.ok(card.source.includes('    t1[Draft]@{ ticket: MC-1 }'), card.source);
  const plain = checked(rename(k, { kind: 'card', i: 1 }, 'Other'), 'Other');
  assert.ok(plain.source.includes('    Other@{ priority: "High" }'), plain.source);
  const column = checked(rename(k, { kind: 'column', i: 0 }, 'Backlog'), 'Backlog');
  assert.ok(column.source.includes('  todo[Backlog]'), column.source);
});

test('renaming to nothing, or to the same text, changes nothing', () => {
  const k = read(BASE);
  assert.equal(rename(k, { kind: 'card', i: 0 }, '   '), null);
  assert.equal(rename(k, { kind: 'card', i: 0 }, 'Write'), null);
});

test('text Pele would read as something else is written under an id, in quotes', () => {
  const k = read(BASE);
  for (const text of ['Fix [bug] (now)', 'mail a@b.com', '@mention', 'say "hi"', '%% not a comment', ':::not a class', '{{x}}']) {
    const edit = checked(rename(k, { kind: 'card', i: 0 }, text));
    assert.equal(labelOf(read(edit.source), edit.pick), text);
  }
});

test('renaming keeps the text of a card that has an id and needs quotes', () => {
  const k = read('kanban\n  A\n    c1[Write]');
  const edit = checked(rename(k, { kind: 'card', i: 0 }, 'Fix (it)'), 'Fix (it)');
  assert.ok(edit.source.includes('c1["Fix (it)"]'), edit.source);
});

test('new ids do not clash with ids the source has', () => {
  const k = read('kanban\n  A\n    c1[One]');
  const edit = checked(rename(k, { kind: 'card', i: 0 }, 'a@b.com'));
  assert.ok(edit.source.includes('c1[a@b.com]'), edit.source);
  const other = checked(rename(read('kanban\n  A\n    c1[One]\n    Two'), { kind: 'card', i: 1 }, 'a@b.com'), 'a@b.com');
  assert.ok(other.source.includes('c2["a@b.com"]'), other.source);
});

test('adds a card under a card, in the same column, and picks it', () => {
  const k = read(BASE);
  const edit = checked(addCard(k, 0, 0), 'New card');
  assert.deepEqual(board(edit.source), [['Todo', 'Write', 'New card', 'Test'], ['Doing', 'Build'], ['Done']]);
  assert.deepEqual(edit.pick, { kind: 'card', i: 1 });
});

test('adds a card at the bottom of a column, including an empty one', () => {
  const k = read(BASE);
  const bottom = checked(addCard(k, 0), 'New card');
  assert.deepEqual(board(bottom.source)[0], ['Todo', 'Write', 'Test', 'New card']);
  const empty = checked(addCard(k, 2), 'New card');
  assert.deepEqual(board(empty.source)[2], ['Done', 'New card']);
  assert.deepEqual(empty.pick, { kind: 'card', i: 3 });
  assert.ok(empty.source.endsWith('  Done\n    New card'));
});

test('adds a card above a card', () => {
  const edit = checked(addCardBefore(read(BASE), 1), 'New card');
  assert.deepEqual(board(edit.source)[0], ['Todo', 'Write', 'New card', 'Test']);
});

test('a new card goes after the icon line of the card above it', () => {
  const k = read('kanban\n  A\n    One\n    ::icon(lucide-book)\n    Two');
  const edit = checked(addCard(k, 0, 0), 'New card');
  assert.deepEqual(board(edit.source)[0], ['A', 'One', 'New card', 'Two']);
  assert.ok(edit.source.indexOf('::icon') < edit.source.indexOf('New card'));
});

test('adds a column to the right of one, or at the end', () => {
  const k = read(BASE);
  const middle = checked(addColumn(k, 0), 'New column');
  assert.deepEqual(board(middle.source).map((c) => c[0]), ['Todo', 'New column', 'Doing', 'Done']);
  assert.deepEqual(middle.pick, { kind: 'column', i: 1 });
  const end = checked(addColumn(k), 'New column');
  assert.deepEqual(board(end.source).map((c) => c[0]), ['Todo', 'Doing', 'Done', 'New column']);
});

test('removes a card, picking the one that takes its place', () => {
  const k = read(BASE);
  const first = checked(remove(k, { kind: 'card', i: 0 }), 'Test');
  assert.deepEqual(board(first.source)[0], ['Todo', 'Test']);
  const last = checked(remove(k, { kind: 'card', i: 1 }), 'Write');
  assert.deepEqual(board(last.source)[0], ['Todo', 'Write']);
  const only = checked(remove(k, { kind: 'card', i: 2 }), 'Doing');
  assert.deepEqual(board(only.source)[1], ['Doing']);
});

test('removes a column with its cards, but not the last column', () => {
  const k = read(BASE);
  const edit = checked(remove(k, { kind: 'column', i: 0 }), 'Doing');
  assert.deepEqual(board(edit.source), [['Doing', 'Build'], ['Done']]);
  const end = checked(remove(k, { kind: 'column', i: 2 }), 'Doing');
  assert.deepEqual(board(end.source).map((c) => c[0]), ['Todo', 'Doing']);
  assert.equal(remove(read('kanban\n  Only\n    Card'), { kind: 'column', i: 0 }), null);
});

test('removing a card takes its icon line with it', () => {
  const k = read('kanban\n  A\n    One\n    ::icon(lucide-book)\n    Two');
  const edit = checked(remove(k, { kind: 'card', i: 0 }), 'Two');
  assert.ok(!edit.source.includes('::icon'));
});

test('moves a card to another column, above a card or at the bottom', () => {
  const k = read(BASE);
  const above = checked(moveCard(k, 0, 1, 2), 'Write');
  assert.deepEqual(board(above.source), [['Todo', 'Test'], ['Doing', 'Write', 'Build'], ['Done']]);
  assert.deepEqual(above.pick, { kind: 'card', i: 1 });
  const bottom = checked(moveCard(k, 0, 2), 'Write');
  assert.deepEqual(board(bottom.source), [['Todo', 'Test'], ['Doing', 'Build'], ['Done', 'Write']]);
});

test('moves a card within its column', () => {
  const k = read(BASE);
  const edit = checked(moveCard(k, 1, 0, 0), 'Test');
  assert.deepEqual(board(edit.source)[0], ['Todo', 'Test', 'Write']);
  const down = checked(moveCard(k, 0, 0), 'Write');
  assert.deepEqual(board(down.source)[0], ['Todo', 'Test', 'Write']);
});

test('a move that leaves the card where it is changes nothing', () => {
  const k = read(BASE);
  assert.equal(moveCard(k, 0, 0, 0), null);
  assert.equal(moveCard(k, 0, 0, 1), null);
  assert.equal(moveCard(k, 1, 0), null);
  assert.equal(moveColumn(k, 2), null);
});

test('a card keeps its data and icon line when it moves', () => {
  const k = read('kanban\n  A\n    One@{ ticket: X-1 }\n    ::icon(lucide-book)\n  B');
  const edit = checked(moveCard(k, 0, 1), 'One');
  assert.equal(edit.source, 'kanban\n  A\n  B\n    One@{ ticket: X-1 }\n    ::icon(lucide-book)');
});

test('moves a column with its cards', () => {
  const k = read(BASE);
  const front = checked(moveColumn(k, 2, 0), 'Done');
  assert.deepEqual(board(front.source).map((c) => c[0]), ['Done', 'Todo', 'Doing']);
  const back = checked(moveColumn(k, 0), 'Todo');
  assert.deepEqual(board(back.source), [['Doing', 'Build'], ['Done'], ['Todo', 'Write', 'Test']]);
  assert.deepEqual(back.pick, { kind: 'column', i: 2 });
});

test('shifts a card up, down and across', () => {
  const k = read(BASE);
  const card = (i: number): Pick => ({ kind: 'card', i });
  assert.equal(shift(k, card(0), 'up'), null);
  assert.deepEqual(board(checked(shift(k, card(0), 'down'), 'Write').source)[0], ['Todo', 'Test', 'Write']);
  assert.equal(shift(k, card(1), 'down'), null);
  assert.deepEqual(board(checked(shift(k, card(1), 'up'), 'Test').source)[0], ['Todo', 'Test', 'Write']);
  // Across keeps its place from the top, as far as the other column goes.
  assert.deepEqual(board(checked(shift(k, card(1), 'right'), 'Test').source), [['Todo', 'Write'], ['Doing', 'Build', 'Test'], ['Done']]);
  assert.deepEqual(board(checked(shift(k, card(0), 'right'), 'Write').source), [['Todo', 'Test'], ['Doing', 'Write', 'Build'], ['Done']]);
  assert.equal(shift(k, card(0), 'left'), null);
  assert.deepEqual(board(checked(shift(k, card(2), 'right'), 'Build').source)[2], ['Done', 'Build']);
});

test('shifts a column left and right', () => {
  const k = read(BASE);
  const column = (i: number): Pick => ({ kind: 'column', i });
  assert.equal(shift(k, column(0), 'left'), null);
  assert.deepEqual(board(checked(shift(k, column(0), 'right'), 'Todo').source).map((c) => c[0]), ['Doing', 'Todo', 'Done']);
  assert.deepEqual(board(checked(shift(k, column(1), 'right'), 'Doing').source).map((c) => c[0]), ['Todo', 'Done', 'Doing']);
  assert.deepEqual(board(checked(shift(k, column(2), 'left'), 'Done').source).map((c) => c[0]), ['Todo', 'Done', 'Doing']);
  assert.equal(shift(k, column(2), 'right'), null);
  assert.equal(shift(k, column(1), 'up'), null);
});

test('arrow keys move between cards and columns', () => {
  const k = read(BASE);
  const card = (i: number): Pick => ({ kind: 'card', i });
  const column = (i: number): Pick => ({ kind: 'column', i });
  assert.deepEqual(neighbour(k, card(0), 'down'), card(1));
  assert.deepEqual(neighbour(k, card(1), 'down'), card(1));
  assert.deepEqual(neighbour(k, card(0), 'up'), column(0));
  assert.deepEqual(neighbour(k, card(1), 'right'), card(2));
  assert.deepEqual(neighbour(k, card(2), 'right'), column(2));
  assert.deepEqual(neighbour(k, card(2), 'left'), card(0));
  assert.deepEqual(neighbour(k, card(0), 'left'), card(0));
  assert.deepEqual(neighbour(k, column(0), 'down'), card(0));
  assert.deepEqual(neighbour(k, column(2), 'down'), column(2));
  assert.deepEqual(neighbour(k, column(0), 'right'), column(1));
  assert.deepEqual(neighbour(k, column(2), 'right'), column(2));
});

test('the same names in different places can be told apart', () => {
  const k = read('kanban\n  A\n    same\n    same\n  A\n    same');
  const edit = checked(rename(k, { kind: 'card', i: 1 }, 'second'), 'second');
  assert.deepEqual(board(edit.source), [['A', 'same', 'second'], ['A', 'same']]);
  const moved = checked(moveCard(k, 2, 0, 0), 'same');
  assert.deepEqual(board(moved.source), [['A', 'same', 'same', 'same'], ['A']]);
  assert.deepEqual(moved.pick, { kind: 'card', i: 0 });
});

test('a deeper indent and a wider column indent are kept', () => {
  const k = read('kanban\n    A\n        c1\n    B');
  const edit = checked(addCard(k, 1), 'New card');
  assert.equal(edit.source, 'kanban\n    A\n        c1\n    B\n      New card');
  const column = checked(addColumn(k, 0), 'New column');
  assert.equal(column.source, 'kanban\n    A\n        c1\n    New column\n    B');
});

test('adds several cards at once, above a card or at the bottom, and picks the first', () => {
  const k = read(BASE);
  const above = checked(addCards(k, 0, ['One', 'Two'], 1), 'One');
  assert.deepEqual(board(above.source)[0], ['Todo', 'Write', 'One', 'Two', 'Test']);
  assert.deepEqual(above.pick, { kind: 'card', i: 1 });
  const bottom = checked(addCards(k, 2, ['One', 'Two']), 'One');
  assert.deepEqual(board(bottom.source)[2], ['Done', 'One', 'Two']);
  assert.ok(bottom.source.includes('\n    One\n    Two'), bottom.source);
});

test('links and other text Pele would misread get their own ids when added together', () => {
  const k = read('kanban\n  A\n    c1[Taken]');
  const edit = checked(addCards(k, 0, ['[[ENG-1 Fix it]]', '[[Some note]]', 'Plain']), '[[ENG-1 Fix it]]');
  assert.deepEqual(board(edit.source)[0], ['A', 'Taken', '[[ENG-1 Fix it]]', '[[Some note]]', 'Plain']);
  assert.ok(edit.source.includes('c2["[[ENG-1 Fix it]]"]') && edit.source.includes('c3["[[Some note]]"]'), edit.source);
});

test('adding no text adds nothing', () => {
  assert.equal(addCards(read(BASE), 0, ['  ', '']), null);
});

test('added cards take the indent of the cards already there', () => {
  const k = read('kanban\n  A\n      deep\n  B');
  assert.equal(checked(addCards(k, 0, ['x']), 'x').source, 'kanban\n  A\n      deep\n      x\n  B');
  assert.equal(checked(addCards(k, 1, ['x']), 'x').source, 'kanban\n  A\n      deep\n  B\n    x');
});

test('cards can be added each under an id of its own, to keep something against', () => {
  const k = read('kanban\n  A\n    c1[Taken]');
  const edit = addCards(k, 0, ['Plain', '[[ENG-1 Fix]]', 'say "hi"'], undefined, true);
  assert.ok(edit);
  assert.deepEqual(edit.ids, ['c2', 'c3', 'c4']);
  assert.doesNotThrow(() => render(edit.source), edit.source);
  const after = read(edit.source);
  assert.deepEqual(after.cards.map((c) => [c.id, c.label]), [['c1', 'Taken'], ['c2', 'Plain'], ['c3', '[[ENG-1 Fix]]'], ['c4', "say 'hi'"]]);
  assert.equal(addCards(k, 0, [' '], undefined, true), null);
});

test('keyed cards can carry data, which Pele draws as a second line and an icon', () => {
  const k = read(BASE);
  const edit = addCards(k, 0, ['[[ENG-1 Fix]]', 'Other'], undefined, true, [metaFor('ENG-1', 'ffc-linear')]);
  assert.ok(edit);
  const after = read(edit.source);
  assert.deepEqual(after.cards.slice(2, 4).map((c) => c.label), ['[[ENG-1 Fix]]', 'Other']);
  assert.ok(edit.source.includes('c1["[[ENG-1 Fix]]"]@{ ticket: "ENG-1", icon: "ffc-linear" }'), edit.source);
  assert.ok(edit.source.includes('c2["Other"]\n'), edit.source);
  const svg = render(edit.source, { icons: () => '<g/>' }).svg;
  assert.ok(svg.includes('class="pele-ticket"') && svg.includes('data-icon="ffc-linear"'), svg);
  // The data stays when the card is renamed or moved.
  const renamed = checked(rename(after, { kind: 'card', i: 2 }, 'Renamed'), 'Renamed');
  assert.ok(renamed.source.includes('c1["Renamed"]@{ ticket: "ENG-1", icon: "ffc-linear" }'), renamed.source);
});
