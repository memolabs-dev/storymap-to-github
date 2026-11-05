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

test('the Markdown draft lists the tree', () => {
  const md = core.toMarkdown(core.buildBacklog(board(), legend));
  assert.match(md, /## Epic: Catalogue/);
  assert.match(md, /- Feature: Find a book\n {2}- Step: Search by title or author\n {2}- \[ \] Task: Back-office · P0 · MVP/);
  assert.match(md, /Milestones: P0 · MVP, P1/);
});
