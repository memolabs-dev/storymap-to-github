import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as core from '../src/core.js';
import * as i18n from '../src/i18n.js';

const YELLOW = { r: 1, g: 0.85, b: 0.4 };
const BLUE = { r: 0.46, g: 0.76, b: 1 };
const GREEN = { r: 0.52, g: 0.85, b: 0.55 };
const VIOLET = { r: 0.75, g: 0.6, b: 1 };
const PINK = { r: 1, g: 0.6, b: 0.8 };

let n = 0;
const sticky = (text, fill, x, y, extra = {}) => ({ id: `s${(n += 1)}`, type: 'STICKY', text, fill, x, y, w: 200, h: 200, ...extra });
const label = (text, x, y) => ({ id: `t${(n += 1)}`, type: 'TEXT', text, x, y, w: 120, h: 40 });

// A small library app map: two epics, their activities and steps, tasks in
// release rows P0 and P1 labelled on the left, one legend sticky, one note.
function board() {
  n = 0;
  return [
    sticky('Epics and goals', YELLOW, -900, -900, { inLegend: true }),
    sticky('Catalogue', YELLOW, 0, 0),
    sticky('Borrowing', YELLOW, 1200, 0),
    sticky('Find a book', BLUE, 0, 300),
    sticky('Add new books', BLUE, 500, 300),
    sticky('Reserve a book', BLUE, 1200, 300),
    sticky('Search by title or author', GREEN, 0, 600),
    sticky('Pick a pickup date', GREEN, 1200, 600),
    label('P0 · MVP', -400, 900),
    sticky('Back-office', VIOLET, 10, 950),
    sticky('Reservation calendar', VIOLET, 1220, 950),
    label('P1', -400, 1400),
    sticky('Import books from a spreadsheet', VIOLET, 520, 1450),
    sticky('Ask two librarians how they shelve books', PINK, 1600, 950),
  ];
}

const legend = core.defaultLegend(core.buildPalette(board()));
const find = (backlog, title) => core.allItems(backlog).find((x) => x.item.title === title).item;

test('hue names cover the FigJam sticky colours', () => {
  assert.equal(core.hueName(YELLOW), 'yellow');
  assert.equal(core.hueName(BLUE), 'blue');
  assert.equal(core.hueName(GREEN), 'green');
  assert.equal(core.hueName(VIOLET), 'violet');
  assert.equal(core.hueName(PINK), 'pink');
  assert.equal(core.hueName({ r: 0.95, g: 0.95, b: 0.95 }), 'white');
  assert.equal(core.hueName({ r: 0.5, g: 0.5, b: 0.5 }), 'gray');
});

test('palette counts colours and the default legend follows the story map', () => {
  const palette = core.buildPalette(board());
  assert.equal(palette.find((c) => c.hue === 'yellow').count, 2, 'the legend sticky is not counted');
  assert.equal(palette.find((c) => c.hue === 'violet').count, 3);
  assert.ok(palette.every((c, i) => i === 0 || palette[i - 1].count >= c.count), 'most used colour first');
  assert.deepEqual(Object.values(legend).sort(), ['epic', 'feature', 'note', 'step', 'task']);
});

test('the board becomes epics, features, steps and tasks with milestones', () => {
  const b = core.buildBacklog(board(), legend);
  assert.deepEqual(b.epics.map((e) => e.title), ['Catalogue', 'Borrowing']);
  const [catalogue, borrowing] = b.epics;
  assert.deepEqual(catalogue.features.map((f) => f.title), ['Find a book', 'Add new books']);
  assert.deepEqual(borrowing.features.map((f) => f.title), ['Reserve a book']);
  assert.deepEqual(catalogue.features[0].steps.map((s) => s.title), ['Search by title or author']);
  assert.deepEqual(catalogue.features[0].tasks.map((t) => [t.title, t.release]), [['Back-office', 'P0 · MVP']]);
  assert.deepEqual(catalogue.features[1].tasks.map((t) => [t.title, t.release]), [['Import books from a spreadsheet', 'P1']]);
  assert.deepEqual(borrowing.features[0].tasks.map((t) => t.title), ['Reservation calendar']);
  assert.deepEqual(b.milestones, ['P0 · MVP', 'P1']);
  assert.deepEqual(b.notes.map((x) => x.title), ['Ask two librarians how they shelve books']);
  assert.equal(b.stats.ignored, 1, 'the legend sticky is not read');
  assert.equal(b.stats.withoutMilestone, 0);
});

test('a release section wins over row labels', () => {
  const items = [...board(), { id: 'sec', type: 'SECTION', name: 'Release 2', x: 0, y: 2000, w: 2000, h: 600 }, sticky('Arabic version', VIOLET, 1210, 2100)];
  const b = core.buildBacklog(items, legend);
  assert.equal(find(b, 'Arabic version').release, 'Release 2');
});

test('colours missing from the legend are reported, not guessed', () => {
  const b = core.buildBacklog([...board(), sticky('Odd one', { r: 0.2, g: 0.2, b: 0.2 }, 0, 3000)], legend);
  assert.deepEqual(b.unmapped, ['#333333']);
});

test('without epics, features stand on their own', () => {
  const b = core.buildBacklog(board().filter((i) => i.fill !== YELLOW), legend);
  assert.equal(b.epics.length, 0);
  assert.deepEqual(b.looseFeatures.map((f) => f.title), ['Find a book', 'Add new books', 'Reserve a book']);
});

test('the backlog survives a structured clone, as postMessage needs', () => {
  assert.doesNotThrow(() => structuredClone(core.buildBacklog(board(), legend)));
});

test('titles match existing issues, ignoring case, accents and prefixes', () => {
  const b = core.buildBacklog(board(), legend);
  const issues = [
    { number: 11, title: 'Épopée : Catalogue', html_url: 'u11' },
    { number: 19, title: 'back-office', html_url: 'u19' },
    { number: 3, title: 'Import the books from a spreadsheet', html_url: 'u3' },
  ];
  const m = core.matchIssues(b, issues);
  assert.equal(m[find(b, 'Catalogue').id].status, 'exists');
  assert.equal(m[find(b, 'Back-office').id].number, 19);
  assert.equal(m[find(b, 'Import books from a spreadsheet').id].status, 'maybe');
  assert.equal(m[find(b, 'Reservation calendar').id].status, 'new');
});

test('epics are only matched with epic issues', () => {
  const b = core.buildBacklog([...board().filter((i) => i.text !== 'Borrowing'), sticky('Accessibility (mobile first)', YELLOW, 1200, 0)], legend);
  const issues = [
    { number: 12, title: 'Épopée : Accessibilité', html_url: 'u12' },
    { number: 39, title: 'Affichage mobile-first', html_url: 'u39' },
  ];
  assert.equal(core.matchIssues(b, issues)[find(b, 'Accessibility (mobile first)').id].number, 12);
});

test('an English sticky meets its French issue when the words are close', () => {
  const b = core.buildBacklog(board(), legend);
  const issues = [{ number: 18, title: 'Calendrier des réservations', html_url: 'u18' }];
  const m = core.matchIssues(b, issues)[find(b, 'Reservation calendar').id];
  assert.deepEqual([m.status, m.number], ['maybe', 18]);
});

test('links set by hand win over guesses, and 0 means not on GitHub', () => {
  const b = core.buildBacklog(board(), legend);
  const issues = [{ number: 20, title: 'Agenda des retraits', html_url: 'u20' }, { number: 19, title: 'back-office', html_url: 'u19' }];
  const calendar = find(b, 'Reservation calendar').id;
  const office = find(b, 'Back-office').id;
  const m = core.matchIssues(b, issues, { [calendar]: 20, [office]: 0 });
  assert.deepEqual([m[calendar].status, m[calendar].number], ['linked', 20]);
  assert.deepEqual([m[office].status, m[office].confirmed], ['new', true]);
});

test('coloured release tags and legend stickies are read as labels, not items', () => {
  const items = [
    ...board().filter((i) => i.text !== 'P0 · MVP'),
    sticky('P0', YELLOW, -420, 900, { w: 40, h: 24 }),
    label('MVP', -360, 900),
    sticky('Activities', BLUE, -700, 300, { w: 80, h: 24 }),
    sticky('Steps : what users go through', GREEN, -700, 600, { w: 80, h: 24 }),
    sticky('Issues or Sub-issues, divided by release', VIOLET, -700, 800, { w: 80, h: 24 }),
  ];
  const b = core.buildBacklog(items, legend);
  assert.deepEqual(b.epics.map((e) => e.title), ['Catalogue', 'Borrowing']);
  assert.equal(b.stats.features, 3);
  assert.equal(b.stats.tasks, 3);
  assert.deepEqual(b.milestones, ['P0 · MVP', 'P1']);
  assert.equal(find(b, 'Back-office').release, 'P0 · MVP');
  assert.ok(!core.buildPalette(items).some((c) => c.samples.includes('P0')), 'labels stay out of the legend tab');
});

test('swimlane lines give each task the label of its lane', () => {
  // The P0 label sits in the middle of its lane; a task at the top of the
  // lane still belongs to P0, not to the lane above.
  const items = [
    ...board().filter((i) => i.text !== 'P0 · MVP'),
    label('P0 · MVP', -400, 1150),
    { id: 'l1', type: 'LINE', x: -500, y: 880, w: 3000, h: 0 },
    // FigJam lines are connectors, sometimes attached to a section at both ends.
    { id: 'l2', type: 'CONNECTOR', from: 'section-1', to: 'section-1', x: -500, y: 1380, w: 3000, h: 30 },
  ];
  const b = core.buildBacklog(items, legend);
  assert.equal(find(b, 'Back-office').release, 'P0 · MVP');
  assert.equal(find(b, 'Import books from a spreadsheet').release, 'P1');
  assert.deepEqual(b.milestones, ['P0 · MVP', 'P1']);
});

test('arrows on the board set the parent and make sub-tasks', () => {
  const items = board();
  const id = (t) => items.find((i) => i.text === t).id;
  items.push(
    sticky('Barcode scan', VIOLET, 10, 1180),
    { id: 'c1', type: 'CONNECTOR', from: id('Reserve a book'), to: id('Back-office') },
    { id: 'c2', type: 'CONNECTOR', from: id('Back-office'), to: 's15' },
  );
  const b = core.buildBacklog(items, legend);
  const borrowing = b.epics[1].features[0];
  assert.deepEqual(borrowing.tasks.map((t) => t.title), ['Back-office', 'Reservation calendar'], 'the arrow wins over the column');
  assert.deepEqual(find(b, 'Back-office').subtasks.map((t) => t.title), ['Barcode scan']);
  assert.equal(b.stats.tasks, 4);
  assert.match(core.toMarkdown(b), / {4}- \[ \] Sub-task: Barcode scan · P0 · MVP/);
});

test('drift lists where linked issues no longer match the map', () => {
  const b = core.buildBacklog(board(), legend);
  const id = (title) => find(b, title).id;
  const issue = (number, title, extra = {}) => ({ number, title, html_url: `u${number}`, state: 'open', state_reason: null, milestone: null, parent: null, ...extra });
  const issues = [
    issue(11, 'Épopée : Catalogue'),
    issue(12, 'Épopée : Borrowing'),
    issue(19, 'Back-office for staff', { milestone: 'P0 · MVP', parent: 11 }),
    issue(3, 'Import books from a spreadsheet', { milestone: 'P0 · MVP', parent: 11 }),
    issue(20, 'Reservation calendar', { milestone: 'P0 · MVP', parent: 11 }),
    issue(30, 'Extra work nobody mapped'),
    issue(31, 'Old idea', { state: 'closed', state_reason: 'completed' }),
  ];
  const links = { [id('Back-office')]: 19, [id('Import books from a spreadsheet')]: 3, [id('Reservation calendar')]: 20 };
  const d = core.findDrift(b, issues, core.matchIssues(b, issues, links));
  const kinds = (title) => d.drifts.filter((x) => x.title === title).map((x) => x.kind);
  assert.deepEqual(kinds('Back-office'), ['title'], 'renamed on GitHub');
  assert.deepEqual(kinds('Import books from a spreadsheet'), ['milestone'], 'P1 on the map, P0 on GitHub');
  assert.deepEqual(kinds('Reservation calendar'), ['parent'], 'under Borrowing on the map, under Catalogue on GitHub');
  assert.deepEqual(kinds('Catalogue'), [], 'an epic prefix is not a drift');
  assert.deepEqual(d.onlyOnGitHub.map((i) => i.number), [30], 'closed issues are not reported as unmapped');
  assert.ok(d.onlyOnBoard.some((x) => x.title === 'Find a book'));
  assert.equal(d.drifts[0].kind, 'milestone', 'the most serious drifts come first');
});

test('an issue closed as not planned is a drift while the map still has it', () => {
  const b = core.buildBacklog(board(), legend);
  const issues = [{ number: 19, title: 'Back-office', html_url: 'u', state: 'closed', state_reason: 'not_planned', milestone: 'P0 · MVP', parent: null }];
  const d = core.findDrift(b, issues, core.matchIssues(b, issues));
  assert.deepEqual(d.drifts.map((x) => x.kind), ['dropped']);
});

test('release names compare by their tags', () => {
  assert.ok(core.sameRelease('P0 · MVP', 'P0 · MVP'));
  assert.ok(core.sameRelease('P0 · MVP', 'MVP'));
  assert.ok(!core.sameRelease('P1', 'P0 · MVP'));
  assert.ok(!core.sameRelease('P1', null));
});

test('the why comes from the issue history', () => {
  const events = [
    { event: 'labeled', actor: { login: 'a' }, created_at: '2026-11-04T15:14:34Z' },
    { event: 'milestoned', actor: { login: 'guillaume' }, created_at: '2026-11-05T13:48:18Z', milestone: { title: 'P1' } },
    { event: 'renamed', actor: { login: 'sam' }, created_at: '2026-11-05T21:38:53Z', rename: { from: 'Automate the countries', to: 'Countries from the survival forms' } },
  ];
  assert.deepEqual(core.explainEvents(events, 'title'), ['2026-11-05, @sam renamed it from "Automate the countries" to "Countries from the survival forms"']);
  assert.deepEqual(core.explainEvents(events, 'milestone'), ['2026-11-05, @guillaume set the milestone to P1']);
  assert.deepEqual(core.explainEvents(events, 'parent'), []);
});

test('project board URLs give the owner and the number', () => {
  assert.deepEqual(core.parseProjectUrl('https://github.com/orgs/acme/projects/44/views/1'), { kind: 'organization', owner: 'acme', number: 44 });
  assert.deepEqual(core.parseProjectUrl('https://github.com/users/jane/projects/5'), { kind: 'user', owner: 'jane', number: 5 });
  assert.equal(core.parseProjectUrl('https://github.com/acme/repo'), null);
  assert.match(core.projectQuery('user'), /owner: user\(login/);
});

// One page of the projectV2 query, shaped like GitHub's answer.
const projectPage = {
  title: 'Library',
  fields: { nodes: [{}, { name: 'Sprint', configuration: {
    iterations: [{ title: 'Sprint 2', startDate: '2026-11-16', duration: 7 }, { title: 'Sprint 4', startDate: '2026-11-30', duration: 7 }],
    completedIterations: [{ title: 'Sprint 1', startDate: '2026-11-09', duration: 7 }],
  } }] },
  items: { pageInfo: { hasNextPage: false }, nodes: [
    { content: { number: 19, repository: { nameWithOwner: 'acme/library' } }, fieldValues: { nodes: [
      {}, { title: 'Sprint 4', startDate: '2026-11-30', duration: 7 }, { name: 'Ready', field: { name: 'Status' } }, { name: 'M', field: { name: 'Size' } },
    ] } },
    { content: {}, fieldValues: { nodes: [] } },
  ] },
};

test('a project page gives sprints with their end date, and each issue its sprint, status and size', () => {
  const p = core.readProject([projectPage]);
  assert.deepEqual(p.sprints.map((s) => [s.title, s.end]), [['Sprint 1', '2026-11-15'], ['Sprint 2', '2026-11-22'], ['Sprint 4', '2026-12-06']]);
  assert.deepEqual(p.items['acme/library#19'], { sprint: { title: 'Sprint 4', start: '2026-11-30', end: '2026-12-06' }, status: 'Ready', size: 'M' });
});

test('a task planned in a sprint ending after its release is due drifts', () => {
  const b = core.buildBacklog(board(), legend);
  const issues = [
    { number: 19, title: 'Back-office', html_url: 'u', state: 'open', milestone: 'P0 · MVP', milestoneDue: '2026-11-30', parent: null, ...core.readProject([projectPage]).items['acme/library#19'] },
    { number: 3, title: 'Import books from a spreadsheet', html_url: 'u3', state: 'open', milestone: 'P1', milestoneDue: '2026-12-31', parent: null, sprint: { title: 'Sprint 4', start: '2026-11-30', end: '2026-12-06' } },
  ];
  const d = core.findDrift(b, issues, core.matchIssues(b, issues));
  const schedule = d.drifts.filter((x) => x.kind === 'schedule');
  assert.deepEqual(schedule.map((x) => [x.title, x.board, x.github]), [['Back-office', 'P0 · MVP, due 2026-11-30', 'Sprint 4, ends 2026-12-06']]);
  assert.equal(d.drifts[0].kind, 'schedule');
});

// The layout of Figma's official story map template: tall row labels on the
// left, 240 px stickies in columns, a how-to text further left.
function officialBoard() {
  n = 0;
  const shape = (text, y, fill) => ({ id: `r${(n += 1)}`, type: 'SHAPE_WITH_TEXT', text, fill, x: 272, y, w: 128, h: 349 });
  const s = (text, fill, x, y) => sticky(text, fill, x, y, { w: 240, h: 240 });
  return [
    { id: 'howto', type: 'TEXT', text: 'Establish your user persona.', x: -400, y: 1547, w: 472, h: 32 },
    shape('User Persona', 496, VIOLET),
    shape('Activities', 938, BLUE),
    shape('Tasks', 1381, PINK),
    shape('Release 1', 1823, YELLOW),
    shape('Release 2', 2265, YELLOW),
    s('Librarian', VIOLET, 480, 535),
    s('Find a book', BLUE, 480, 993),
    s('Lend a book', BLUE, 760, 993),
    s('Search the catalogue', PINK, 480, 1435),
    s('Scan the card', PINK, 760, 1435),
    s('Search by title', YELLOW, 480, 1856),
    s('Due date reminder', YELLOW, 760, 1856),
    s('Search by author', YELLOW, 480, 2320),
    s('', YELLOW, 760, 2320),
  ];
}

test("Figma's official template is read by rows, not by colours", () => {
  const items = officialBoard();
  const b = core.buildBacklog(items, core.defaultLegend(core.buildPalette(items)));
  assert.equal(b.mode, 'rows');
  assert.deepEqual(b.epics.map((e) => e.title), ['Find a book', 'Lend a book']);
  assert.deepEqual(b.epics[0].features.map((f) => f.title), ['Search the catalogue']);
  assert.deepEqual(b.epics[0].features[0].tasks.map((t) => [t.title, t.release]), [['Search by title', 'Release 1'], ['Search by author', 'Release 2']]);
  assert.deepEqual(b.epics[1].features[0].tasks.map((t) => [t.title, t.release]), [['Due date reminder', 'Release 1']]);
  assert.deepEqual(b.notes.map((x) => x.title), ['Librarian'], 'the persona is a note, not an issue');
  assert.deepEqual(b.milestones, ['Release 1', 'Release 2']);
  assert.deepEqual(b.rows.map((r) => [r.name, r.type, r.count]), [['User Persona', 'note', 1], ['Activities', 'epic', 2], ['Tasks', 'feature', 2], ['Release 1', 'task', 2], ['Release 2', 'task', 1]]);
});

test('the reading mode and the meaning of each row can be changed', () => {
  const items = officialBoard();
  const legend2 = core.defaultLegend(core.buildPalette(items));
  assert.equal(core.buildBacklog(items, legend2, { mode: 'colours' }).mode, 'colours');
  const b = core.buildBacklog(items, legend2, { rowTypes: { 'User Persona': 'ignore', Activities: 'feature', Tasks: 'step' } });
  assert.equal(b.notes.length, 0);
  assert.equal(b.epics.length, 0);
  assert.deepEqual(b.looseFeatures.map((f) => [f.title, f.steps.map((x) => x.title)]), [['Find a book', ['Search the catalogue']], ['Lend a book', ['Scan the card']]]);
});

test('a small colour legend does not switch the board to rows', () => {
  const items = [...board(), sticky('Activities', BLUE, -700, 300, { w: 80, h: 24 }), sticky('Tasks', VIOLET, -700, 900, { w: 80, h: 24 })];
  assert.equal(core.buildBacklog(items, legend).mode, 'colours');
});

test('the Markdown draft lists the tree', () => {
  const md = core.toMarkdown(core.buildBacklog(board(), legend));
  assert.match(md, /## Epic: Catalogue/);
  assert.match(md, /- Feature: Find a book\n {2}- Step: Search by title or author\n {2}- \[ \] Task: Back-office · P0 · MVP/);
  assert.match(md, /Milestones: P0 · MVP, P1/);
});

test('a selected sticky gets its three best candidate issues, with the words they share', () => {
  const issues = [
    { number: 19, title: 'Le back-office : vérifier et corriger la donnée' },
    { number: 18, title: 'Calendrier des réservations' },
    { number: 11, title: 'Épopée : Catalogue' },
    { number: 7, title: 'Une page qui montre le design system' },
  ];
  const s = core.suggestIssues('Reservation calendar', 'task', issues);
  assert.equal(s[0].number, 18);
  assert.deepEqual(s[0].shared.sort(), ['calen', 'reser']);
  assert.ok(s.every((x) => x.number !== 11), 'epics are not offered for a task');
  assert.deepEqual(core.suggestIssues('Catalogue', 'epic', issues).map((x) => x.number), [11]);
});

test('the board label sums up the issue in a few words', () => {
  assert.equal(core.labelText({ number: 19, state: 'open', sprint: { title: 'Sprint 1' }, status: 'Ready' }), '#19 · Sprint 1 · Ready');
  assert.equal(core.labelText({ number: 8, state: 'open', sprint: 'Sprint 2' }), '#8 · Sprint 2');
  assert.equal(core.labelText({ number: 3, state: 'closed', status: 'Done' }), '#3 · Closed');
});

// Publishing a sticky: the issue it would become, before anything is written.
const repoMeta = { types: ['Task', 'Feature', 'Bug'], milestones: [{ title: 'P0 · MVP', number: 3 }] };
const publishing = { startLabel: 'needs-refinement', startStatus: 'Backlog' };

test('a task is drafted with its parent, its milestone and the starting label', () => {
  const b = core.buildBacklog(board(), legend);
  const issues = [{ number: 7, title: 'Find a book' }];
  const matches = core.matchIssues(b, issues);
  const task = find(b, 'Back-office');
  const d = core.draftIssue(task.id, b, matches, repoMeta, publishing);
  assert.equal(d.kind, 'task');
  assert.equal(d.title, 'Back-office');
  assert.equal(d.type, 'Task');
  assert.deepEqual(d.labels, ['needs-refinement']);
  assert.deepEqual(d.parent, { id: find(b, 'Find a book').id, title: 'Find a book', number: 7 });
  assert.deepEqual(d.milestone, { title: 'P0 · MVP', number: 3 });
  assert.equal(d.status, 'Backlog');
  assert.deepEqual(d.warnings, []);
});

test('a missing issue type becomes a label, a missing parent or milestone a warning', () => {
  const b = core.buildBacklog(board(), legend);
  const matches = core.matchIssues(b, []);
  const epic = core.draftIssue(b.epics[0].id, b, matches, repoMeta, { startLabel: '', startStatus: '' });
  assert.equal(epic.type, null);
  assert.deepEqual(epic.labels, ['epic']);
  assert.equal(epic.parent, null);
  assert.equal(epic.status, null);
  const task = core.draftIssue(find(b, 'Import books from a spreadsheet').id, b, matches, repoMeta, publishing);
  assert.equal(task.parent.number, null);
  assert.equal(task.milestone, null);
  assert.equal(task.warnings.length, 2);
  assert.match(task.warnings[0], /Add new books/);
  assert.match(task.warnings[1], /P1/);
});

test('a feature body lists its steps, and a linked sticky has no draft', () => {
  const b = core.buildBacklog(board(), legend);
  const feature = find(b, 'Find a book');
  const d = core.draftIssue(feature.id, b, core.matchIssues(b, []), repoMeta, publishing);
  assert.equal(d.type, 'Feature');
  assert.equal(d.parent.title, 'Catalogue');
  assert.match(d.body, /- \[ \] Search by title or author/);
  const linked = core.matchIssues(b, [{ number: 7, title: 'Find a book' }]);
  assert.equal(core.draftIssue(feature.id, b, linked, repoMeta, publishing), null);
});

test('the issue text starts from a user story template with the sticky filled in', () => {
  const b = core.buildBacklog(board(), legend);
  const matches = core.matchIssues(b, [{ number: 7, title: 'Find a book' }]);
  const task = find(b, 'Back-office');
  const d = core.draftIssue(task.id, b, matches, repoMeta, publishing);
  assert.match(d.body, /\*\*As a\*\*/);
  assert.match(d.body, /\*\*I want\*\* Back-office/);
  assert.match(d.body, /Acceptance criteria/);
  assert.match(d.body, /Part of: Find a book \(#7\)/);
  assert.match(d.body, /Release on the map: P0 · MVP/);
});

test('each team can set its own issue text, with placeholders', () => {
  const b = core.buildBacklog(board(), legend);
  const feature = find(b, 'Find a book');
  const template = 'Story: {title}\nEpic: {parent}\nRelease: {release}\n{steps}';
  const d = core.draftIssue(feature.id, b, core.matchIssues(b, []), repoMeta, { ...publishing, bodyTemplate: template });
  assert.equal(d.body, 'Story: Find a book\nEpic: Catalogue\n- [ ] Search by title or author', 'a line left empty by a placeholder is dropped');
});

test('a project page gives the size field, its options and each card, so sizes can be set', () => {
  const page = {
    ...projectPage,
    id: 'PVT_1',
    fields: { nodes: [...projectPage.fields.nodes, { id: 'F_status', name: 'Status', options: [{ id: 's1', name: 'Ready' }] }, { id: 'F_size', name: 'Size', options: [{ id: 'o1', name: 'S' }, { id: 'o2', name: 'M' }] }] },
    items: { ...projectPage.items, nodes: projectPage.items.nodes.map((n, i) => ({ ...n, id: `PVTI_${i}` })) },
  };
  const p = core.readProject([page]);
  assert.equal(p.id, 'PVT_1');
  assert.deepEqual(p.sizeField, { id: 'F_size', name: 'Size', options: [{ id: 'o1', name: 'S' }, { id: 'o2', name: 'M' }] });
  assert.equal(p.itemIds['acme/library#19'], 'PVTI_0');
  assert.equal(core.readProject([projectPage]).sizeField, null, 'a board without a size field has none');
});

test('each difference says what the map wants, and one kept on purpose stays away until it changes', () => {
  const b = core.buildBacklog(board(), legend);
  const id = (title) => find(b, title).id;
  const issue = (number, title, extra = {}) => ({ number, title, html_url: `u${number}`, state: 'open', state_reason: null, milestone: null, parent: null, ...extra });
  const issues = [
    issue(11, 'Épopée : Catalogue'),
    issue(12, 'Épopée : Borrowing'),
    issue(19, 'Back-office for staff', { milestone: 'P0 · MVP', parent: 11 }),
    issue(3, 'Import books from a spreadsheet', { milestone: 'P0 · MVP', parent: 11 }),
    issue(20, 'Reservation calendar', { milestone: 'P0 · MVP', parent: 11 }),
  ];
  const links = { [id('Back-office')]: 19, [id('Import books from a spreadsheet')]: 3, [id('Reservation calendar')]: 20 };
  const matches = core.matchIssues(b, issues, links);
  const all = core.findDrift(b, issues, matches).drifts;
  const of = (kind) => all.find((x) => x.kind === kind);
  assert.equal(of('title').target, 'Back-office');
  assert.equal(of('milestone').target, 'P1');
  assert.equal(of('parent').target, 12, 'the map puts it under Borrowing, #12');

  const kept = { [of('title').id]: [core.driftKey(of('title'))] };
  const after = core.findDrift(b, issues, matches, kept).drifts;
  assert.ok(!after.some((x) => x.kind === 'title'), 'kept on purpose');
  const renamedAgain = issues.map((i) => (i.number === 19 ? { ...i, title: 'Back-office v2' } : i));
  assert.ok(core.findDrift(b, renamedAgain, matches, kept).drifts.some((x) => x.kind === 'title'), 'back when GitHub changes again');
});

test('a batch is published parents first, so each issue finds its parent', () => {
  const b = core.buildBacklog(board(), legend);
  const ids = ['Reservation calendar', 'Borrowing', 'Reserve a book', 'Catalogue'].map((t) => find(b, t).id);
  const order = core.publishOrder(b, ids).map((id) => core.allItems(b).find((x) => x.item.id === id).item.title);
  assert.deepEqual(order, ['Catalogue', 'Borrowing', 'Reserve a book', 'Reservation calendar']);
  assert.deepEqual(core.publishOrder(b, ['not-on-the-map']), [], 'unknown ids are dropped');
});

test('what moved since the week started: new, closed, and changed issues with before and after', () => {
  const before = [
    { number: 3, title: 'Import books', state: 'open', milestone: 'P1', status: 'Backlog', sprint: null, size: 'S', assignees: [] },
    { number: 7, title: 'Search', state: 'open', milestone: 'P0', status: 'In progress', sprint: { title: 'Sprint 1' }, size: 'M', assignees: ['ana'] },
    { number: 9, title: 'Old idea', state: 'open', milestone: null, status: 'Backlog', size: null, assignees: [] },
  ];
  const snapshot = core.snapshotOf(before);
  const now = [
    { number: 3, title: 'Import books from a spreadsheet', state: 'open', milestone: 'P1', status: 'Ready', sprint: { title: 'Sprint 2' }, size: 'S', assignees: ['tom'] },
    { number: 7, title: 'Search', state: 'closed', milestone: 'P0', status: 'Done', sprint: { title: 'Sprint 1' }, size: 'M', assignees: ['ana'] },
    { number: 9, title: 'Old idea', state: 'open', milestone: null, status: 'Backlog', size: null, assignees: [] },
    { number: 12, title: 'Reservation calendar', state: 'open', milestone: 'P0', status: 'Backlog', size: null, assignees: [] },
  ];
  const moved = core.changesSince(snapshot, now);
  assert.deepEqual(moved.map((m) => [m.number, m.kind]), [[12, 'new'], [7, 'closed'], [3, 'changed']]);
  const three = moved.find((m) => m.number === 3);
  assert.deepEqual(three.changes, [
    { field: 'Title', from: 'Import books', to: 'Import books from a spreadsheet' },
    { field: 'Status', from: 'Backlog', to: 'Ready' },
    { field: 'Sprint', from: 'None', to: 'Sprint 2' },
    { field: 'Assignees', from: 'None', to: '@tom' },
  ]);
  assert.equal(core.changesSince(snapshot, before).length, 0, 'nothing moved');
});

test('each role does its own changes, and the split can be changed', () => {
  assert.equal(core.canDo('pm', 'size'), true, 'sizes are the product manager\'s');
  assert.equal(core.canDo('techlead', 'size'), false);
  assert.equal(core.canDo('pm', 'parent'), false, 'the split is the tech lead\'s');
  assert.equal(core.canDo('techlead', 'parent'), true);
  assert.equal(core.canDo('both', 'parent'), true, 'someone with both roles does everything');
  assert.equal(core.canDo('techlead', 'size', { size: 'both' }), true, 'a team can share a field');
  assert.equal(core.canDo('pm', 'unknown'), true, 'an action nobody owns is open to all');
});

test('the starting template is a story map the plugin reads by rows', () => {
  const shapes = core.starterLayout();
  n = 0;
  const items = shapes.map((s) => ({ id: `n${(n += 1)}`, type: s.kind === 'label' ? 'SHAPE_WITH_TEXT' : 'STICKY', text: s.text, fill: s.fill, x: s.x, y: s.y, w: s.w, h: s.h }));
  const b = core.buildBacklog(items, {});
  assert.equal(b.mode, 'rows');
  assert.deepEqual(b.rows.map((r) => r.name), ['User Persona', 'Activities', 'Tasks', 'Release 1', 'Release 2']);
  assert.equal(b.stats.epics, 1);
  assert.equal(b.stats.features, 1);
  assert.equal(b.stats.tasks, 2);
  assert.deepEqual(b.milestones, ['Release 1', 'Release 2']);
  assert.equal(b.notes.length, 1);
});

// English and French. Every French test puts English back when it ends.
const inFrench = (fn) => {
  i18n.setLang('fr');
  try {
    fn();
  } finally {
    i18n.setLang('en');
  }
};

test('the language follows the setting, or the system when automatic', () => {
  assert.equal(i18n.resolveLang('auto', 'fr-FR'), 'fr');
  assert.equal(i18n.resolveLang('auto', 'en-US'), 'en');
  assert.equal(i18n.resolveLang('auto', ''), 'en');
  assert.equal(i18n.resolveLang('en', 'fr-FR'), 'en', 'an explicit choice wins');
  assert.equal(i18n.resolveLang('fr', 'en-GB'), 'fr');
});

test('plural forms are right in both languages', () => {
  assert.equal(i18n.plural(1, '{n} epic', '{n} epics'), '1 epic');
  assert.equal(i18n.plural(2, '{n} epic', '{n} epics'), '2 epics');
  assert.equal(i18n.plural(0, '{n} epic', '{n} epics'), '0 epics');
  inFrench(() => {
    assert.equal(i18n.plural(1, '{n} epic', '{n} epics'), '1 épopée');
    assert.equal(i18n.plural(2, '{n} epic', '{n} epics'), '2 épopées');
    assert.equal(i18n.plural(0, '{n} epic', '{n} epics'), '0 épopée', 'French takes the singular for 0');
    assert.equal(i18n.plural(3, 'Create {n} issue', 'Create {n} issues'), 'Créer 3 issues');
  });
});

test('t() fills placeholders and falls back to English for a missing key', () => {
  assert.equal(i18n.t('Use {repo}', { repo: 'acme/library' }), 'Use acme/library');
  inFrench(() => {
    assert.equal(i18n.t('Use {repo}', { repo: 'acme/library' }), 'Utiliser acme/library');
    assert.equal(i18n.t('A text nobody translated, {n}', { n: 2 }), 'A text nobody translated, 2');
    assert.equal(i18n.t('New'), 'Nouvelle');
    assert.equal(i18n.t('New', undefined, 'sticky'), 'Nouveau', 'a context tells apart two French words');
    assert.equal(i18n.t('Why?'), 'Pourquoi ?', 'a non-breaking space before ? in French');
  });
});

test('a French draft has the French user story and French warnings', () => {
  const b = core.buildBacklog(board(), legend);
  const matches = core.matchIssues(b, [{ number: 7, title: 'Find a book' }]);
  inFrench(() => {
    const d = core.draftIssue(find(b, 'Back-office').id, b, matches, repoMeta, publishing);
    assert.match(d.body, /\*\*En tant que\*\*/);
    assert.match(d.body, /\*\*Je veux\*\* Back-office/);
    assert.match(d.body, /### Critères d'acceptation/);
    assert.match(d.body, /Fait partie de : Find a book \(#7\)/);
    assert.match(d.body, /Release sur la carte : P0 · MVP/);
    const epic = core.draftIssue(b.epics[0].id, b, core.matchIssues(b, []), repoMeta, publishing);
    assert.ok(!/Fait partie de/.test(epic.body), 'a line left empty by a placeholder is dropped, with the French colon too');
    assert.ok(!/Release sur la carte/.test(epic.body));
    const task = core.draftIssue(find(b, 'Import books from a spreadsheet').id, b, core.matchIssues(b, []), repoMeta, publishing);
    assert.match(task.warnings[0], /^«\u00a0Add new books\u00a0» n'est pas encore sur GitHub/);
    assert.match(task.warnings[1], /^Aucun jalon sur GitHub ne correspond à la release «\u00a0P1\u00a0»/);
  });
  assert.match(core.defaultBody(), /^\*\*As a\*\*/, 'English again after the French test');
});

test('a difference kept on purpose stays kept in the other language', () => {
  const b = core.buildBacklog(board(), legend);
  const issues = [{ number: 3, title: 'Import books from a spreadsheet', html_url: 'u3', state: 'open', state_reason: null, milestone: null, parent: null }];
  const matches = core.matchIssues(b, issues, { [find(b, 'Import books from a spreadsheet').id]: 3 });
  const english = core.findDrift(b, issues, matches).drifts.find((x) => x.kind === 'milestone');
  assert.equal(english.github, 'No milestone');
  inFrench(() => {
    const french = core.findDrift(b, issues, matches).drifts.find((x) => x.kind === 'milestone');
    assert.equal(french.github, 'Aucun jalon');
    assert.equal(core.driftKey(french), core.driftKey(english));
    const kept = { [french.id]: [core.driftKey(english)] };
    assert.ok(!core.findDrift(b, issues, matches, kept).drifts.some((x) => x.kind === 'milestone'));
  });
});

test('the French starting template is read by rows too', () => {
  inFrench(() => {
    const shapes = core.starterLayout();
    n = 0;
    const items = shapes.map((s) => ({ id: `n${(n += 1)}`, type: s.kind === 'label' ? 'SHAPE_WITH_TEXT' : 'STICKY', text: s.text, fill: s.fill, x: s.x, y: s.y, w: s.w, h: s.h }));
    const b = core.buildBacklog(items, {});
    assert.equal(b.mode, 'rows');
    assert.deepEqual(b.rows.map((r) => r.name), ['Persona', 'Activités', 'Tâches', 'Release 1', 'Release 2']);
    assert.equal(b.stats.epics, 1);
    assert.equal(b.stats.tasks, 2);
  });
});

test('the project board gives its statuses in order, for the starting status', () => {
  const page = { ...projectPage, fields: { nodes: [...projectPage.fields.nodes, { id: 'F_status', name: 'Status', options: [{ id: 's1', name: 'Todo' }, { id: 's2', name: 'Done' }] }] } };
  assert.deepEqual(core.readProject([page]).statusOptions, ['Todo', 'Done']);
  assert.deepEqual(core.readProject([projectPage]).statusOptions, []);
});

// Every text the code passes to t() or plural() has a French translation
// with the same placeholders, French spacing and no long dashes.
test('every text shown has a French translation', () => {
  const quoted = String.raw`(['"])((?:\\.|(?!\1)[^\\\n])*)\1`;
  const second = quoted.replace(/\\1/g, '\\3');
  const keys = new Set();
  for (const file of ['core.js', 'main.ts', 'ui.tsx']) {
    const source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
    for (const m of source.matchAll(new RegExp(String.raw`\bt\(\s*` + quoted, 'g'))) keys.add(m[2]);
    for (const m of source.matchAll(new RegExp(String.raw`\bplural\([^'"]*?` + quoted + String.raw`\s*,\s*` + second, 'g'))) keys.add(m[2]).add(m[4]);
  }
  const unescape = (s) => s.replace(/\\(.)/g, '$1');
  const holes = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
  assert.ok(keys.size > 200, `found ${keys.size} texts`);
  const missing = [...keys].map(unescape).filter((k) => !(k in i18n.FR));
  assert.deepEqual(missing, []);
  for (const [en, fr] of Object.entries(i18n.FR)) {
    assert.equal(holes(fr), holes(en.replace(/^\w+:/, '')), `same placeholders: ${en}`);
    assert.ok(!/ [:;?!»]|« /.test(fr), `non-breaking space in: ${fr}`);
    assert.ok(!/[\u2013\u2014]/.test(fr), `no long dash in: ${fr}`);
  }
});
