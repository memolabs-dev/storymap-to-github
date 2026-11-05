// A made-up story map for the browser preview: a community library app.
// Epics on top, activities (features) and steps below, tasks in release rows
// labelled on the left. Colours are close to the FigJam sticky palette.
const SAMPLE_COLOURS = {
  yellow: { r: 1, g: 0.85, b: 0.4 },
  blue: { r: 0.46, g: 0.76, b: 1 },
  green: { r: 0.52, g: 0.85, b: 0.55 },
  violet: { r: 0.75, g: 0.6, b: 1 },
  pink: { r: 1, g: 0.6, b: 0.8 },
};

function sampleBoard() {
  let n = 0;
  const s = (text, colour, x, y) => ({ id: `n${(n += 1)}`, type: 'STICKY', text, fill: SAMPLE_COLOURS[colour], x, y, w: 200, h: 200 });
  const row = (text, y) => ({ id: `n${(n += 1)}`, type: 'TEXT', text, x: -400, y, w: 160, h: 40 });
  return [
    { ...s('Epics and goals', 'yellow', -900, -900), inLegend: true },
    s('Catalogue', 'yellow', 0, 0),
    s('Borrowing', 'yellow', 1500, 0),
    s('Accounts', 'yellow', 2700, 0),
    s('Accessibility (mobile first)', 'yellow', 3300, 0),
    s('Find a book', 'blue', 0, 300),
    s('Add new books', 'blue', 700, 300),
    s('Reserve a book', 'blue', 1500, 300),
    s('Return a book', 'blue', 2100, 300),
    s('Sign up with a library card', 'blue', 2700, 300),
    s('Search by title or author', 'green', 0, 600),
    s('From the delivery box to the shelf', 'green', 700, 600),
    s('Pick a pickup date', 'green', 1500, 600),
    row('P0 · MVP', 900),
    s('Search page', 'violet', 0, 950),
    s('Book detail page', 'violet', 220, 950),
    s('Back-office for librarians', 'violet', 700, 950),
    s('Reservation calendar', 'violet', 1500, 950),
    s('Late return reminder', 'violet', 2100, 950),
    s('Ask two librarians how they shelve new books', 'pink', 900, 1180),
    row('P1', 1500),
    s('Import books from a spreadsheet', 'violet', 700, 1550),
    s('Waiting list when a book is out', 'violet', 1500, 1550),
    s('Card number check', 'violet', 2700, 1550),
    row('P2', 1900),
    s('Large text mode', 'violet', 3300, 1950),
    row('P3', 2300),
    s('Arabic version', 'violet', 3320, 2350),
  ];
}
