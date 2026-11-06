const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../code.js');

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

test('the Markdown draft lists the tree', () => {
  const md = core.toMarkdown(core.buildBacklog(board(), legend));
  assert.match(md, /## Epic: Catalogue/);
  assert.match(md, /- Feature: Find a book\n {2}- Step: Search by title or author\n {2}- \[ \] Task: Back-office · P0 · MVP/);
  assert.match(md, /Milestones: P0 · MVP, P1/);
});
