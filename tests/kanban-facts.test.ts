import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Initiative, Issue, Project } from '../src/issues/types.ts';
import { factsOf, metaFor, priorityBar, shortName } from '../src/canvas/kanban-facts.ts';

const issue = {
  identifier: 'ENG-12', priority: 2, assignee: { name: 'Trang Doan', avatarUrl: null }, state: { name: 'Todo', type: 'unstarted', color: '#aaa' },
} as Issue;
const project = {
  status: { name: 'In Progress', type: 'started', color: '#f2c94c' }, lead: { name: 'Trang Doan', avatarUrl: null }
} as unknown as Project;
const initiative = { status: 'Active', owner: null } as Initiative;

test('an issue says its id, assignee, priority and state marker', () => {
  assert.deepEqual(factsOf({ kind: 'issue', item: issue }), {
    ticket: 'ENG-12', assigned: 'Trang Doan', priority: 2, marker: { type: 'unstarted', color: '#aaa' },
  });
  const unassigned = factsOf({ kind: 'issue', item: { ...issue, assignee: null, state: null } });
  assert.equal(unassigned.assigned, undefined);
  assert.equal(unassigned.marker, undefined);
});

test('a project says what it is, its status, lead and marker', () => {
  assert.deepEqual(factsOf({ kind: 'project', item: project }), {
    ticket: 'Project · In Progress', assigned: 'Trang Doan', marker: { type: 'started', color: '#f2c94c' },
  });
  const bare = factsOf({ kind: 'project', item: { ...project, status: null } });
  assert.equal(bare.ticket, 'Project');
  assert.equal(bare.marker, undefined);
});

test('an initiative says what it is and its status, with the default colour', () => {
  assert.deepEqual(factsOf({ kind: 'initiative', item: initiative }), {
    ticket: 'Initiative · Active', assigned: undefined, marker: { type: 'started', color: '' },
  });
  assert.equal(factsOf({ kind: 'initiative', item: { ...initiative, status: 'Planned' } }).marker?.type, 'unstarted');
  assert.equal(factsOf({ kind: 'initiative', item: { ...initiative, status: 'Mystery' } }).marker?.type, 'backlog');
});

test('nothing is said until the service has answered', () => {
  assert.deepEqual(factsOf(undefined), {});
});

test('the data a held card is written with has no quotes to break it', () => {
  assert.equal(metaFor('ENG-12', 'ffc-linear'), '@{ ticket: "ENG-12", icon: "ffc-linear" }');
  assert.equal(metaFor('a "b"\nc', 'x'), '@{ ticket: "a  b  c", icon: "x" }');
});

test('urgent and high priority get a red bar, low a faint one, and medium or none no bar', () => {
  assert.equal(priorityBar(1)?.opacity, '1');
  assert.equal(priorityBar(2)?.opacity, '0.5');
  assert.equal(priorityBar(2)?.stroke, priorityBar(1)?.stroke);
  assert.notEqual(priorityBar(4)?.stroke, priorityBar(1)?.stroke);
  assert.equal(priorityBar(3), null);
  assert.equal(priorityBar(0), null);
  assert.equal(priorityBar(undefined), null);
});

test('a long name is cut short', () => {
  assert.equal(shortName('Trang Doan'), 'Trang Doan');
  assert.equal(shortName('Alexandria Montgomery-Smith'), 'Alexandria Mont…');
  assert.equal(shortName('Alexandria Montgomery-Smith').length, 16);
});
