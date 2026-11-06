// Storymap to GitHub: the board reading logic, with no Figma API in it, so
// it runs the same in the plugin and in node:test (see test/). Types are in
// core.d.ts. Texts shown to people go through t() (see i18n.js).
import { getLang, t } from './i18n.js';

const TYPES = ['epic', 'feature', 'step', 'task', 'note', 'ignore'];

// Default reading of the sticky colours, after Jeff Patton's story map:
// yellow epics, blue activities (features), green steps, violet tasks,
// pink questions for the product owners. Every colour can be remapped.
const DEFAULT_TYPE_BY_HUE = {
  yellow: 'epic',
  blue: 'feature',
  green: 'step',
  violet: 'task',
  pink: 'note',
};

// Labels that start a release row or name a release section.
const RELEASE_PATTERN = /^\s*(P\d+|MVP|Release\s*\d+|R\d+|V\d+(\.\d+)*|Sprint\s*\d+|Milestone\s*\d+)\b/i;
// Sections whose name matches this are never read (the board's legend).
const LEGEND_PATTERN = /\b(legend|légende|key)\b/i;

function hexOf(c) {
  const to = (v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');
  return `#${to(c.r)}${to(c.g)}${to(c.b)}`;
}

// Name the hue of a fill, so a default type can be guessed from any palette.
function hueName(c) {
  const max = Math.max(c.r, c.g, c.b);
  const min = Math.min(c.r, c.g, c.b);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (s < 0.18) return l > 0.85 ? 'white' : 'gray';
  let h;
  if (max === c.r) h = ((c.g - c.b) / d) % 6;
  else if (max === c.g) h = (c.b - c.r) / d + 2;
  else h = (c.r - c.g) / d + 4;
  h = (h * 60 + 360) % 360;
  if (h < 15 || h >= 345) return 'red';
  if (h < 40) return 'orange';
  if (h < 70) return 'yellow';
  if (h < 160) return 'green';
  if (h < 195) return 'teal';
  if (h < 250) return 'blue';
  if (h < 290) return 'violet';
  return 'pink';
}

function text(item) {
  return (item.text || '').replace(/\s+/g, ' ').trim();
}

// The colours found on the board, most used first, with a few sample texts.
function buildPalette(items) {
  const byHex = new Map();
  for (const item of items) {
    if (!item.fill || item.inLegend || (item.type !== 'STICKY' && item.type !== 'SHAPE_WITH_TEXT')) continue;
    if (isReleaseLabel(item) || LEGEND_TEXT.test(text(item))) continue;
    const hex = hexOf(item.fill);
    if (!byHex.has(hex)) byHex.set(hex, { hex, hue: hueName(item.fill), count: 0, samples: [] });
    const entry = byHex.get(hex);
    entry.count += 1;
    if (entry.samples.length < 3 && text(item)) entry.samples.push(text(item));
  }
  return [...byHex.values()].sort((a, b) => b.count - a.count);
}

function defaultLegend(palette) {
  const legend = {};
  for (const colour of palette) legend[colour.hex] = DEFAULT_TYPE_BY_HUE[colour.hue] || 'ignore';
  return legend;
}

function center(item) {
  return { x: item.x + item.w / 2, y: item.y + item.h / 2 };
}

function contains(box, point) {
  return point.x >= box.x && point.x <= box.x + box.w && point.y >= box.y && point.y <= box.y + box.h;
}

function overlapX(a, b) {
  return Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
}

// The item of `list` whose left edge is closest to `x` without passing it:
// in a story map, a parent sits above its first child and covers the next
// ones until the following parent starts.
function nearestLeft(list, x) {
  let best = null;
  for (const item of list) {
    if (item.x <= x && (!best || item.x > best.x)) best = item;
  }
  return best;
}

function maxOverlap(list, target) {
  let best = null;
  let bestOverlap = 0;
  for (const item of list) {
    const o = overlapX(item, target);
    if (o > bestOverlap) {
      best = item;
      bestOverlap = o;
    }
  }
  return best;
}

// Releases come from sections named like a release ("P0 · MVP", "Release 1")
// or from short labels that start a row. A task takes the section that holds
// it, otherwise the last row label at or above it.
// A short sticky, shape or text such as "P0", "MVP" or "Release 2" labels a
// row, whatever its colour: boards often colour their release tags.
function isReleaseLabel(item) {
  if (item.type !== 'STICKY' && item.type !== 'SHAPE_WITH_TEXT' && item.type !== 'TEXT') return false;
  const label = text(item);
  return label.length <= 30 && RELEASE_PATTERN.test(label);
}

// A sticky that explains the colours ("Epics and targets", "Activities: …",
// "Issues or sub-issues") belongs to the board's legend, not to the map.
const LEGEND_TEXT = /^\s*(epics?|activit(y|ies)|steps?|tasks?|issues?|sub-?issues?|stor(y|ies)|features?)\b\s*(and\b|or\b|[:,(-]|$)/i;

function findReleases(items) {
  const sections = [];
  const labels = [];
  for (const item of items) {
    if (item.type === 'SECTION') {
      const match = (item.name || '').match(RELEASE_PATTERN);
      if (match) sections.push({ name: item.name.trim(), box: item });
    } else if (isReleaseLabel(item)) {
      labels.push({ name: text(item), x: item.x, y: item.y, h: item.h });
    }
  }
  // Labels on the same line ("P0" next to "MVP") name one row: "P0 · MVP".
  labels.sort((a, b) => a.y - b.y);
  const rows = [];
  for (const label of labels) {
    const last = rows[rows.length - 1];
    if (last && label.y < last.y + Math.max(last.h, label.h)) last.parts.push(label);
    else rows.push({ y: label.y, h: label.h, parts: [label] });
  }
  for (const row of rows) row.name = row.parts.sort((a, b) => a.x - b.x).map((p) => p.name).join(' · ');

  // Long horizontal lines split the board into swimlanes. When there are
  // some, a task takes the label of its lane, wherever the label sits in it.
  const rules = items
    .filter((i) => (i.type === 'LINE' || i.type === 'CONNECTOR') && i.w >= 600 && i.w > 10 * i.h)
    .map((i) => i.y + i.h / 2)
    .sort((a, b) => a - b);
  const lanes = [];
  if (rules.length) {
    const laneOf = (y) => rules.filter((r) => r <= y).length;
    for (const row of rows) {
      const lane = laneOf(row.y + row.h / 2);
      if (!lanes[lane]) lanes[lane] = row.name;
      else if (!lanes[lane].includes(row.name)) lanes[lane] += ` · ${row.name}`;
    }
    return { sections, rows, rules, lanes, laneOf };
  }
  return { sections, rows, rules, lanes, laneOf: null };
}

function releaseOf(item, releases) {
  const c = center(item);
  const section = releases.sections.find((s) => contains(s.box, c));
  if (section) return section.name;
  if (releases.laneOf) {
    const lane = releases.lanes[releases.laneOf(c.y)];
    if (lane) return lane;
  }
  let row = null;
  for (const r of releases.rows) if (r.y <= c.y + r.h / 2) row = r;
  return row ? row.name : null;
}

// Reading by rows, as in Figma's official story map template: labelled rows
// (User Persona, Activities, Tasks, Release 1, Release 2…) give the kind of
// every sticky in them, whatever its colour.
const ROW_KINDS = [
  { kind: 'persona', re: /^(user\s*)?personas?$/i },
  { kind: 'activities', re: /^(user\s*)?(activit(y|ies|[ée]s?)|backbone|epics?|[ée]pop[ée]es?|themes?|goals?)$/i },
  { kind: 'steps', re: /^([ée]tapes?|steps?)$/i },
  { kind: 'tasks', re: /^(user\s*)?(tasks?|t[aâ]ches?|features?|fonctionnalit[ée]s?|walking\s*skeleton|narrative\s*flow)$/i },
];
const DEFAULT_ROW_TYPES = { persona: 'note', activities: 'epic', steps: 'step', tasks: 'feature', release: 'task' };

function rowKindOf(label) {
  if (RELEASE_PATTERN.test(label)) return 'release';
  const found = ROW_KINDS.find((k) => k.re.test(label));
  return found ? found.kind : null;
}

// The labelled rows of a board, top to bottom. A row runs from its label
// down to the next label.
function findRows(items) {
  const rows = [];
  for (const item of items) {
    if (item.inLegend || (item.type !== 'STICKY' && item.type !== 'SHAPE_WITH_TEXT' && item.type !== 'TEXT')) continue;
    const label = text(item);
    if (!label || label.length > 30) continue;
    const kind = rowKindOf(label);
    if (kind) rows.push({ id: item.id, name: label, kind, x: item.x, y: item.y, w: item.w, h: item.h });
  }
  rows.sort((a, b) => a.y - b.y);
  return rows;
}

// Rows are read automatically when the board has row labels for Activities
// or Tasks that are at least about as tall as a sticky, as in Figma's
// template. Small labels are usually a colour legend (as on many team
// boards), so the colours are read instead; the Legend tab can force rows.
function usesRows(rows, items) {
  const heights = items.filter((i) => i.type === 'STICKY').map((i) => i.h).sort((a, b) => a - b);
  const typical = heights.length ? heights[Math.floor(heights.length / 2)] : 0;
  const lanes = rows.filter((r) => r.kind !== 'release' && r.h >= 0.8 * typical);
  return lanes.some((r) => r.kind === 'activities' || r.kind === 'tasks');
}

// Turn the raw board items into the backlog tree.
// items: [{ id, type, text, name, fill, x, y, w, h, inLegend }] and connectors
//        [{ id, type: 'CONNECTOR', from, to }]
// legend: { '#rrggbb': type }, used when reading by colour
// options: { mode: 'auto' | 'rows' | 'colours', rowTypes: { [row name]: type } }
function buildBacklog(items, legend, options = {}) {
  const typed = { epic: [], feature: [], step: [], task: [], note: [] };
  let ignored = 0;
  const unmapped = new Set();
  const rows = findRows(items);
  const mode = options.mode === 'rows' || (options.mode !== 'colours' && usesRows(rows, items)) ? 'rows' : 'colours';
  const rowTypes = options.rowTypes || {};
  const typeOfRow = (row) => rowTypes[row.name] || DEFAULT_ROW_TYPES[row.kind];
  const rowIds = new Set(rows.map((r) => r.id));
  const left = rows.length ? Math.min(...rows.map((r) => r.x)) : -Infinity;
  const rowAt = (y) => {
    let found = null;
    for (const r of rows) if (r.y <= y) found = r;
    return found;
  };
  const rowCounts = {};

  for (const item of items) {
    if (item.type !== 'STICKY' && item.type !== 'SHAPE_WITH_TEXT') continue;
    if (mode === 'rows') {
      if (rowIds.has(item.id)) continue;
      const c = center(item);
      const row = c.x > left ? rowAt(c.y) : null;
      const type = row ? typeOfRow(row) : null;
      if (item.inLegend || !text(item) || !type || type === 'ignore') {
        ignored += 1;
        continue;
      }
      rowCounts[row.name] = (rowCounts[row.name] || 0) + 1;
      const hex = item.fill ? hexOf(item.fill) : null;
      typed[type].push({ id: item.id, title: text(item), x: item.x, y: item.y, w: item.w, h: item.h, hex, ...(row.kind === 'release' ? { release: row.name } : {}) });
      continue;
    }
    if (item.inLegend || !text(item) || isReleaseLabel(item) || LEGEND_TEXT.test(text(item))) {
      ignored += 1;
      continue;
    }
    const hex = item.fill ? hexOf(item.fill) : null;
    const type = hex ? legend[hex] : undefined;
    if (!type) {
      if (hex) unmapped.add(hex);
      ignored += 1;
      continue;
    }
    if (type === 'ignore') {
      ignored += 1;
      continue;
    }
    typed[type].push({ id: item.id, title: text(item), x: item.x, y: item.y, w: item.w, h: item.h, hex });
  }

  const releases = findReleases(items.filter((i) => !i.inLegend));
  const byX = (a, b) => a.x - b.x || a.y - b.y;
  const epics = typed.epic.sort(byX).map((e) => ({ ...e, features: [], tasks: [] }));
  const features = typed.feature.sort(byX).map((f) => ({ ...f, steps: [], tasks: [] }));
  const orphans = [];

  for (const feature of features) {
    const epic = nearestLeft(epics, center(feature).x);
    if (epic) epic.features.push(feature);
    else if (epics.length) orphans.push({ ...feature, kind: 'feature' });
  }

  for (const step of typed.step.sort(byX)) {
    const feature = nearestLeft(features, center(step).x);
    if (feature) {
      feature.steps.push(step);
      step.feature = feature;
    } else orphans.push({ ...step, kind: 'step' });
  }

  // Arrows drawn on the board win over position: an arrow between a task and
  // a feature, step or epic gives the task its parent; an arrow between two
  // tasks makes the lower one a sub-task of the upper one.
  const kindOf = new Map();
  for (const e of epics) kindOf.set(e.id, { kind: 'epic', node: e });
  for (const f of features) kindOf.set(f.id, { kind: 'feature', node: f });
  for (const s of typed.step) kindOf.set(s.id, { kind: 'step', node: s });
  for (const t of typed.task) kindOf.set(t.id, { kind: 'task', node: t });
  const drawnParent = new Map();
  const subtaskOf = new Map();
  for (const c of items) {
    if (c.type !== 'CONNECTOR' || (c.w >= 600 && c.w > 10 * c.h)) continue; // a swimlane line, not an arrow
    const a = kindOf.get(c.from);
    const b = kindOf.get(c.to);
    if (!a || !b || a === b) continue;
    if (a.kind === 'task' && b.kind === 'task') {
      const [upper, lower] = a.node.y < b.node.y || (a.node.y === b.node.y && a.node.x < b.node.x) ? [a.node, b.node] : [b.node, a.node];
      if (!subtaskOf.has(lower.id)) subtaskOf.set(lower.id, upper.id);
    } else if (a.kind === 'task' || b.kind === 'task') {
      const [task, other] = a.kind === 'task' ? [a, b] : [b, a];
      if (!drawnParent.has(task.node.id)) drawnParent.set(task.node.id, other);
    }
  }

  const columns = [...features, ...typed.step];
  const taskById = new Map();
  for (const raw of typed.task.sort((a, b) => a.y - b.y || a.x - b.x)) {
    const task = { ...raw, release: raw.release || releaseOf(raw, releases), subtasks: [] };
    taskById.set(task.id, task);
    if (subtaskOf.has(task.id)) continue;
    const drawn = drawnParent.get(task.id);
    if (drawn && drawn.kind === 'epic') {
      drawn.node.tasks.push(task);
      continue;
    }
    const column = drawn ? drawn.node : maxOverlap(columns, task) || nearestLeft(features, center(task).x);
    const feature = column ? column.feature || (features.includes(column) ? column : null) : null;
    if (feature) {
      feature.tasks.push(task);
      continue;
    }
    const epic = maxOverlap(epics, task) || nearestLeft(epics, center(task).x);
    if (epic) epic.tasks.push(task);
    else orphans.push({ ...task, kind: 'task' });
  }
  for (const [childId, parentId] of subtaskOf) taskById.get(parentId).subtasks.push(taskById.get(childId));

  // Features with no epic above them stand on their own when the map has no epics.
  const looseFeatures = epics.length ? [] : features;
  for (const f of features) for (const s of f.steps) delete s.feature;

  const rowNames = releases.laneOf ? releases.lanes.filter(Boolean) : releases.rows.map((r) => r.name);
  const names = mode === 'rows' ? rows.filter((r) => r.kind === 'release').map((r) => r.name) : [...releases.sections.map((s) => s.name), ...rowNames];
  const milestones = [...new Set(names)];
  const tasks = [...taskById.values()];

  return {
    mode,
    rows: rows.map((r) => ({ name: r.name, kind: r.kind, type: typeOfRow(r), count: rowCounts[r.name] || 0 })),
    epics,
    looseFeatures,
    notes: typed.note.sort(byX),
    orphans,
    milestones,
    stats: {
      epics: epics.length,
      features: features.length,
      steps: typed.step.length,
      tasks: typed.task.length,
      notes: typed.note.length,
      ignored,
      withoutMilestone: tasks.filter((t) => !t.release).length,
      swimlaneLines: releases.rules.length,
    },
    unmapped: [...unmapped],
  };
}

// Issue matching. Titles are compared after removing case, accents, an
// "Epic:" prefix and small words; words are cut to five letters so that
// "transparency" meets "transparence". A title match is only a guess: the
// team confirms it, or links the item by hand (see `links`).
const EPIC_TITLE = /^\s*(epic|[ée]pop[ée]e)\s*:/i;
const STOP_WORDS = new Set(['the', 'and', 'for', 'with', 'from', 'into', 'les', 'des', 'une', 'pour', 'dans', 'avec', 'sur', 'aux', 'par', 'est']);

function normalize(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/^(epic|epopee|feature|task)\s*:\s*/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function stems(s) {
  return new Set(normalize(s).split(' ').filter((w) => w.length > 2 && !STOP_WORDS.has(w)).map((w) => w.slice(0, 5)));
}

// 1 for the same words, less as they differ. `loose` also accepts a title
// whose words are all found in the other one (used for epics).
function similarity(a, b, loose = false) {
  const A = stems(a);
  const B = stems(b);
  if (!A.size || !B.size) return 0;
  let shared = 0;
  for (const w of A) if (B.has(w)) shared += 1;
  const jaccard = shared / (A.size + B.size - shared);
  const smaller = Math.min(A.size, B.size);
  const contained = shared / smaller;
  if (loose) return Math.max(jaccard, contained);
  return smaller >= 2 ? Math.max(jaccard, contained * 0.8) : jaccard;
}

const isEpicIssue = (issue) => issue.type === 'Epic' || EPIC_TITLE.test(issue.title);

function allItems(backlog) {
  const withSubtasks = (tasks) => tasks.flatMap((t) => [t, ...withSubtasks(t.subtasks || [])]);
  const tasksOf = (f) => withSubtasks(f.tasks);
  return [
    ...backlog.epics.map((e) => ({ item: e, kind: 'epic' })),
    ...backlog.epics.flatMap((e) => [
      ...e.features.map((f) => ({ item: f, kind: 'feature' })),
      ...[...withSubtasks(e.tasks), ...e.features.flatMap(tasksOf)].map((t) => ({ item: t, kind: 'task' })),
    ]),
    ...backlog.looseFeatures.map((f) => ({ item: f, kind: 'feature' })),
    ...backlog.looseFeatures.flatMap(tasksOf).map((t) => ({ item: t, kind: 'task' })),
  ];
}

// For each item, the GitHub issue it already is, if any.
// links: { [itemId]: issueNumber | 0 } set by hand; 0 means "not on GitHub".
// Returns { [itemId]: { status: 'linked' | 'exists' | 'maybe' | 'new', number, title, url } }
function matchIssues(backlog, issues, links = {}) {
  const result = {};
  const byNumber = new Map(issues.map((i) => [i.number, i]));
  const epicIssues = issues.filter(isEpicIssue);
  const otherIssues = issues.filter((i) => !isEpicIssue(i));
  for (const { item, kind } of allItems(backlog)) {
    if (item.id in links) {
      const linked = byNumber.get(links[item.id]);
      result[item.id] = linked ? { status: 'linked', number: linked.number, title: linked.title, url: linked.html_url } : { status: 'new', confirmed: true };
      continue;
    }
    const pool = kind === 'epic' && epicIssues.length ? epicIssues : otherIssues;
    const target = normalize(item.title);
    let best = null;
    let bestScore = 0;
    for (const issue of pool) {
      const score = normalize(issue.title) === target ? 1.01 : similarity(item.title, issue.title, kind === 'epic');
      if (score > bestScore) {
        best = issue;
        bestScore = score;
      }
    }
    if (best && bestScore > 1) result[item.id] = { status: 'exists', number: best.number, title: best.title, url: best.html_url };
    else if (best && bestScore >= 0.5) result[item.id] = { status: 'maybe', number: best.number, title: best.title, url: best.html_url };
    else result[item.id] = { status: 'new' };
  }
  return result;
}

// Drift: where the map and GitHub no longer say the same thing.
// Only items linked to an issue (by hand, or by an identical title) are
// compared; nothing is written anywhere.
const RELEASE_TOKENS = /(P\d+|MVP|Release\s*\d+|R\d+|V\d+(?:\.\d+)*|Sprint\s*\d+|Milestone\s*\d+)/gi;

function releaseTokens(s) {
  return new Set([...(s || '').matchAll(RELEASE_TOKENS)].map((m) => m[1].toUpperCase().replace(/\s+/g, ' ')));
}

function sameRelease(a, b) {
  const A = releaseTokens(a);
  const B = releaseTokens(b);
  if (!A.size && !B.size) return true;
  for (const t of A) if (B.has(t)) return true;
  return false;
}

// issues: [{ number, title, html_url, state, state_reason, milestone, parent }]
// Returns { drifts: [{ id, title, kind, number, url, board, github }], onlyOnGitHub, onlyOnBoard, toConfirm }
// What identifies one difference: when either side changes, it is a new one.
// The key is made from the English texts, so a difference kept on purpose
// stays kept whatever language the plugin shows.
const driftKey = (d) => d.key || `${d.kind}|${d.number}|${d.board}|${d.github}`;

// kept: { [stickyId]: [driftKey] } differences the team keeps on purpose.
// Each difference carries `target`, what the map wants: the sticky's title,
// its release, or the number of the issue it should sit under.
function findDrift(backlog, issues, matches, kept = {}) {
  const byNumber = new Map(issues.map((i) => [i.number, i]));
  const linked = (item) => {
    const m = matches[item.id];
    return m && (m.status === 'linked' || m.status === 'exists') ? byNumber.get(m.number) : null;
  };
  // Release due dates come from the repository milestones of the same name.
  const milestones = new Map();
  for (const i of issues) if (i.milestone && i.milestoneDue) milestones.set(i.milestone, i.milestoneDue);
  const dueOf = (release) => {
    for (const [title, date] of milestones) if (sameRelease(release, title)) return { title, date };
    return null;
  };
  const drifts = [];
  const onlyOnBoard = [];
  const toConfirm = [];
  const used = new Set();

  // en: the texts in English, for the key; shown: the same, translated.
  const add = (base, kind, en, shown, extra = {}) => {
    const d = { ...base, kind, board: en.board, github: en.github, ...extra };
    drifts.push({ ...d, key: driftKey(d), board: shown.board, github: shown.github });
  };
  const check = (item, kind, ancestors) => {
    const issue = linked(item);
    const m = matches[item.id];
    if (!issue) {
      if (m && m.status === 'maybe') toConfirm.push({ id: item.id, title: item.title, kind, number: m.number });
      else onlyOnBoard.push({ id: item.id, title: item.title, kind });
      return;
    }
    used.add(issue.number);
    const base = { id: item.id, title: item.title, number: issue.number, url: issue.html_url };
    if (issue.state === 'closed' && (issue.state_reason === 'not_planned' || issue.state_reason === 'duplicate')) {
      const github = issue.state_reason === 'duplicate' ? 'Closed as duplicate' : 'Closed as not planned';
      add(base, 'dropped', { board: 'Still on the map', github }, { board: t('Still on the map'), github: t(github) });
    }
    if (normalize(item.title) !== normalize(issue.title)) {
      const sides = { board: item.title, github: issue.title };
      add(base, 'title', sides, sides, { target: item.title });
    }
    // Planned too late: the sprint ends after the due date of the release
    // the map puts the task in.
    const due = kind === 'task' && item.release ? dueOf(item.release) : null;
    if (due && issue.sprint && issue.sprint.end > due.date) {
      const v = { release: item.release, date: due.date, sprint: issue.sprint.title, end: issue.sprint.end };
      add(
        base,
        'schedule',
        { board: `${item.release}, due ${due.date}`, github: `${issue.sprint.title}, ends ${issue.sprint.end}` },
        { board: t('{release}, due {date}', v), github: t('{sprint}, ends {end}', v) },
      );
    }
    if (kind === 'task' && !sameRelease(item.release, issue.milestone)) {
      const en = { board: item.release || 'No release row', github: issue.milestone || 'No milestone' };
      add(base, 'milestone', en, { board: item.release || t('No release row'), github: issue.milestone || t('No milestone') }, { target: item.release || null });
    }
    const expected = ancestors.map(linked).filter(Boolean);
    if (expected.length && !expected.some((p) => p.number === issue.parent)) {
      const parent = issue.parent ? byNumber.get(issue.parent) : null;
      const numbers = expected.map((p) => `#${p.number}`);
      const github = (say) =>
        parent ? say('Under #{n} {title}', { n: parent.number, title: parent.title }) : issue.parent ? say('Under #{n}', { n: issue.parent }) : say('No parent issue');
      add(
        base,
        'parent',
        { board: `Under ${numbers.join(' or ')}`, github: github(fill) },
        { board: t('Under {numbers}', { numbers: numbers.join(t(' or ')) }), github: github(t) },
        { target: expected[0].number },
      );
    }
  };

  const walkTasks = (tasks, ancestors) => {
    for (const t of tasks) {
      check(t, 'task', ancestors);
      walkTasks(t.subtasks || [], [t, ...ancestors]);
    }
  };
  for (const epic of backlog.epics) {
    check(epic, 'epic', []);
    walkTasks(epic.tasks, [epic]);
    for (const f of epic.features) {
      check(f, 'feature', [epic]);
      walkTasks(f.tasks, [f, epic]);
    }
  }
  for (const f of backlog.looseFeatures) {
    check(f, 'feature', []);
    walkTasks(f.tasks, [f]);
  }

  const order = { dropped: 0, schedule: 1, milestone: 2, parent: 3, title: 4 };
  drifts.sort((a, b) => order[a.kind] - order[b.kind]);
  const onlyOnGitHub = issues
    .filter((i) => i.state === 'open' && !used.has(i.number))
    .map((i) => ({ number: i.number, title: i.title, url: i.html_url, milestone: i.milestone }));
  const open = drifts.filter((d) => !(kept[d.id] || []).includes(driftKey(d)));
  return { drifts: open, onlyOnGitHub, onlyOnBoard, toConfirm };
}

// Fills {placeholders} without translating, for the English key of a drift.
const fill = (s, vars = {}) => s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));

// The "why" of a drift, read from the issue's history on GitHub.
// events: the raw list from GET /repos/{owner}/{repo}/issues/{n}/events
function explainEvents(events, kind) {
  const wanted = {
    title: ['renamed'],
    milestone: ['milestoned', 'demilestoned'],
    schedule: ['milestoned', 'demilestoned'],
    parent: ['parent_issue_added', 'parent_issue_removed'],
    dropped: ['closed', 'reopened'],
  }[kind] || [];
  const day = (iso) => (iso || '').slice(0, 10);
  return events
    .filter((e) => wanted.includes(e.event))
    .map((e) => {
      const v = { when: day(e.created_at), who: e.actor ? `@${e.actor.login}` : t('someone') };
      if (e.event === 'renamed') return t('{when}, {who} renamed it from "{from}" to "{to}"', { ...v, from: e.rename.from, to: e.rename.to });
      if (e.event === 'milestoned') return t('{when}, {who} set the milestone to {milestone}', { ...v, milestone: e.milestone.title });
      if (e.event === 'demilestoned') return t('{when}, {who} removed the milestone {milestone}', { ...v, milestone: e.milestone.title });
      if (e.event === 'parent_issue_added') return t('{when}, {who} set its parent issue', v);
      if (e.event === 'parent_issue_removed') return t('{when}, {who} removed its parent issue', v);
      if (e.event === 'closed') {
        return e.commit_id ? t('{when}, {who} closed it with commit {commit}', { ...v, commit: e.commit_id.slice(0, 7) }) : t('{when}, {who} closed it', v);
      }
      return t('{when}, {who} reopened it', v);
    });
}

// GitHub Projects: the sprint, status and size of each issue. Sprints are
// iteration fields; any iteration field counts, whatever its name.
function parseProjectUrl(url) {
  const m = (url || '').trim().match(/github\.com\/(orgs|users)\/([\w.-]+)\/projects\/(\d+)/);
  return m ? { kind: m[1] === 'orgs' ? 'organization' : 'user', owner: m[2], number: Number(m[3]) } : null;
}

function projectQuery(kind) {
  return `query($owner: String!, $number: Int!, $cursor: String) {
  owner: ${kind === 'user' ? 'user' : 'organization'}(login: $owner) {
    projectV2(number: $number) {
      id
      title
      fields(first: 50) { nodes {
        ... on ProjectV2IterationField { name configuration {
          iterations { title startDate duration } completedIterations { title startDate duration } } }
        ... on ProjectV2SingleSelectField { id name options { id name } }
      } }
      items(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          content { ... on Issue { number repository { nameWithOwner } } }
          fieldValues(first: 30) { nodes {
            ... on ProjectV2ItemFieldIterationValue { title startDate duration }
            ... on ProjectV2ItemFieldSingleSelectValue { name field { ... on ProjectV2FieldCommon { name } } }
          } }
        }
      }
    }
  }
}`;
}

function addDays(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// The board field that holds sizes or estimates, by its usual names.
const SIZE_FIELD = /size|taille|estimat|poids|effort/i;

const sprintOf = (v) => ({ title: v.title, start: v.startDate, end: addDays(v.startDate, v.duration - 1) });

// pages: the `projectV2` object of each page returned by projectQuery.
// Returns { id, title, sprints: [{ title, start, end }], items: { 'owner/repo#12': { sprint, status, size } },
//   sizeField: { id, name, options: [{ id, name }] } | null, statusOptions: [name], itemIds: { 'owner/repo#12': cardId } }
function readProject(pages) {
  const sprints = [];
  for (const field of pages[0].fields.nodes) {
    if (!field || !field.configuration) continue;
    for (const it of [...field.configuration.completedIterations, ...field.configuration.iterations]) sprints.push(sprintOf(it));
  }
  sprints.sort((a, b) => (a.start < b.start ? -1 : 1));
  const size = pages[0].fields.nodes.find((f) => f && f.options && SIZE_FIELD.test(f.name));
  const sizeField = size ? { id: size.id, name: size.name, options: size.options.map((o) => ({ id: o.id, name: o.name })) } : null;
  // The Status field's options, in the board's order: a new issue starts in
  // the first one unless the team names another.
  const status = pages[0].fields.nodes.find((f) => f && f.options && /^status$/i.test(f.name));
  const statusOptions = status ? status.options.map((o) => o.name) : [];
  const items = {};
  const itemIds = {};
  for (const page of pages) {
    for (const node of page.items.nodes) {
      const issue = node.content;
      if (!issue || !issue.number) continue;
      if (node.id) itemIds[`${issue.repository.nameWithOwner}#${issue.number}`.toLowerCase()] = node.id;
      const entry = {};
      for (const v of node.fieldValues.nodes) {
        if (!v) continue;
        if (v.startDate) entry.sprint = sprintOf(v);
        else if (v.name && v.field && /status|statut/i.test(v.field.name)) entry.status = v.name;
        else if (v.name && v.field && SIZE_FIELD.test(v.field.name)) entry.size = v.name;
      }
      items[`${issue.repository.nameWithOwner}#${issue.number}`.toLowerCase()] = entry;
    }
  }
  return { id: pages[0].id || null, title: pages[0].title, sprints, items, sizeField, statusOptions, itemIds };
}

// A Markdown draft of the backlog, to paste into an issue or a note.
function toMarkdown(backlog, matches = {}) {
  const ref = (item) => {
    const m = matches[item.id];
    return m && m.number ? ` (#${m.number}${m.status === 'maybe' ? '?' : ''})` : '';
  };
  const lines = [];
  const task = (item, depth = 1) => {
    lines.push(`${'  '.repeat(depth)}- [ ] ${t(depth > 1 ? 'Sub-task: {title}' : 'Task: {title}', { title: item.title })}${item.release ? ` · ${item.release}` : ''}${ref(item)}`);
    for (const s of item.subtasks || []) task(s, depth + 1);
  };
  const feature = (f, indent) => {
    lines.push(`${indent}- ${t('Feature: {title}', { title: f.title })}${ref(f)}`);
    for (const s of f.steps) lines.push(`${indent}  - ${t('Step: {title}', { title: s.title })}`);
    f.tasks.forEach((x) => task(x));
  };
  for (const epic of backlog.epics) {
    lines.push(`## ${t('Epic: {title}', { title: epic.title })}${ref(epic)}`, '');
    for (const f of epic.features) feature(f, '');
    epic.tasks.forEach((x) => task(x));
    lines.push('');
  }
  for (const f of backlog.looseFeatures) feature(f, '');
  if (backlog.milestones.length) lines.push('', t('Milestones: {list}', { list: backlog.milestones.join(', ') }));
  return lines.join('\n').trim() + '\n';
}

// The few issues a sticky most likely is, best first, with the words they
// share, so the team picks from three instead of scrolling every issue.
function suggestIssues(title, kind, issues, count = 3) {
  const pool = kind === 'epic' && issues.some(isEpicIssue) ? issues.filter(isEpicIssue) : issues.filter((i) => !isEpicIssue(i));
  const mine = stems(title);
  return pool
    .map((issue) => {
      const theirs = stems(issue.title);
      const shared = [...mine].filter((w) => theirs.has(w));
      const score = normalize(issue.title) === normalize(title) ? 1.01 : similarity(title, issue.title, kind === 'epic');
      return { number: issue.number, title: issue.title, score, shared };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.number - b.number)
    .slice(0, count);
}

// The short text of the label the plugin puts on a linked sticky:
// "#19 · Sprint 1 · Ready", or "#19 · Closed".
function labelText(issue) {
  const parts = [`#${issue.number}`];
  if (issue.state === 'closed') parts.push(t('Closed'));
  else {
    if (issue.sprint) parts.push(typeof issue.sprint === 'string' ? issue.sprint : issue.sprint.title);
    if (issue.status) parts.push(issue.status);
  }
  return parts.join(' · ');
}

// The parent of every epic, feature and task on the map: a feature's epic,
// a task's feature (or epic), a sub-task's task.
function parentsOf(backlog) {
  const parents = new Map();
  const tasks = (list, parent) => {
    for (const t of list) {
      parents.set(t.id, parent);
      tasks(t.subtasks || [], { item: t, kind: 'task' });
    }
  };
  for (const e of backlog.epics) {
    tasks(e.tasks, { item: e, kind: 'epic' });
    for (const f of e.features) {
      parents.set(f.id, { item: e, kind: 'epic' });
      tasks(f.tasks, { item: f, kind: 'feature' });
    }
  }
  for (const f of backlog.looseFeatures) tasks(f.tasks, { item: f, kind: 'feature' });
  return parents;
}

const TYPE_NAMES = { epic: 'Epic', feature: 'Feature', task: 'Task' };

// The text a new issue starts with: a user story to complete, then where the
// sticky sits on the map. Each team can set its own, per repository.
// Placeholders: {title}, {parent}, {release}, {steps} (a checklist).
const DEFAULT_BODY = {
  en: [
    '**As a** …',
    '**I want** {title}',
    '**So that** …',
    '',
    '### Acceptance criteria',
    '- [ ] …',
    '{steps}',
    '',
    '---',
    'From the story map in FigJam.',
    'Part of: {parent}',
    'Release on the map: {release}',
  ].join('\n'),
  fr: [
    '**En tant que** …',
    '**Je veux** {title}',
    '**Afin de** …',
    '',
    "### Critères d'acceptation",
    '- [ ] …',
    '{steps}',
    '',
    '---',
    'Depuis la story map dans FigJam.',
    'Fait partie de\u00a0: {parent}',
    'Release sur la carte\u00a0: {release}',
  ].join('\n'),
};

// The default text, in the language the plugin shows.
const defaultBody = () => DEFAULT_BODY[getLang()] || DEFAULT_BODY.en;

// Fills the placeholders; a line that a placeholder left with nothing after
// its label ("Release on the map: ") is dropped, and so is an empty {steps}.
function fillTemplate(template, values) {
  const lines = [];
  for (const line of template.split('\n')) {
    let empty = false;
    const filled = line.replace(/\{(title|parent|release|steps)\}/g, (_, key) => {
      if (!values[key]) empty = true;
      return values[key] || '';
    });
    if (empty && (/:\s*$/.test(filled) || !filled.trim())) continue;
    lines.push(filled);
  }
  return lines.join('\n').trim();
}
const isIssue = (m) => Boolean(m) && (m.status === 'linked' || m.status === 'exists');

// The issue a sticky would become, shown to the team before anything is
// written. repo: { types: issue type names of the owner, milestones: [{ title,
// number }] }. publishing: { startLabel, startStatus }, both may be empty.
// Returns null for a sticky that already is an issue.
function draftIssue(id, backlog, matches, repo, publishing) {
  const found = allItems(backlog).find((x) => x.item.id === id);
  if (!found || isIssue(matches[id])) return null;
  const { item, kind } = found;
  const warnings = [];
  const typeName = TYPE_NAMES[kind];
  const type = (repo.types || []).includes(typeName) ? typeName : null;
  const labels = [...(type ? [] : [kind]), ...(publishing.startLabel ? [publishing.startLabel] : [])];

  const up = parentsOf(backlog).get(id) || null;
  let parent = null;
  if (up) {
    const pm = matches[up.item.id];
    parent = { id: up.item.id, title: up.item.title, number: isIssue(pm) ? pm.number : null };
    if (parent.number === null) warnings.push(t('"{title}" is not on GitHub yet: publish it first to make this issue its sub-issue.', { title: up.item.title }));
  }

  let milestone = null;
  if (item.release) {
    const hit = (repo.milestones || []).find((ms) => sameRelease(item.release, ms.title));
    if (hit) milestone = { title: hit.title, number: hit.number };
    else warnings.push(t('No milestone on GitHub matches the release "{release}": the issue will have none.', { release: item.release }));
  }

  const body = fillTemplate(publishing.bodyTemplate || defaultBody(), {
    title: item.title,
    parent: parent ? `${parent.title}${parent.number ? ` (#${parent.number})` : ''}` : '',
    release: item.release || '',
    steps: kind === 'feature' && item.steps ? item.steps.map((s) => `- [ ] ${s.title}`).join('\n') : '',
  });

  return { id, kind, title: item.title, body, type, labels, parent, milestone, status: publishing.startStatus || null, warnings };
}

// The order to publish a batch in: epics, then features, then tasks, a task
// before its sub-tasks, so each new issue can be put under a parent that
// already exists. Ids that are not on the map are dropped.
function publishOrder(backlog, ids) {
  const wanted = new Set(ids);
  const rank = { epic: 0, feature: 1, task: 2 };
  return allItems(backlog)
    .map((x, index) => ({ id: x.item.id, rank: rank[x.kind], index }))
    .filter((x) => wanted.has(x.id))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((x) => x.id);
}

// What moved since the week started. The snapshot keeps, for each issue, the
// fields a weekly looks at, including the board's (status, sprint, size),
// which GitHub's issue history does not record.
const WATCHED = [
  ['title', 'Title'],
  ['milestone', 'Milestone'],
  ['status', 'Status'],
  ['sprint', 'Sprint'],
  ['size', 'Size'],
  ['assignees', 'Assignees'],
];

function snapshotOf(issues) {
  const snap = {};
  for (const i of issues) {
    snap[i.number] = {
      title: i.title,
      state: i.state || 'open',
      milestone: i.milestone || null,
      status: i.status || null,
      sprint: i.sprint ? (typeof i.sprint === 'string' ? i.sprint : i.sprint.title) : null,
      size: i.size || null,
      assignees: (i.assignees || []).map((a) => `@${a}`).join(', ') || null,
    };
  }
  return snap;
}

// Returns [{ number, title, kind: 'new' | 'closed' | 'reopened' | 'changed',
// changes: [{ field, from, to }] }], new issues first, then closed or
// reopened ones, then the others.
function changesSince(snapshot, issues) {
  const now = snapshotOf(issues);
  const order = { new: 0, closed: 1, reopened: 1, changed: 2 };
  const moved = [];
  for (const [n, after] of Object.entries(now)) {
    const number = Number(n);
    const before = snapshot[n];
    if (!before) {
      moved.push({ number, title: after.title, kind: 'new', changes: [] });
      continue;
    }
    const changes = WATCHED.filter(([key]) => (before[key] || null) !== (after[key] || null)).map(([key, field]) => ({
      field: t(field),
      from: before[key] || t('None'),
      to: after[key] || t('None'),
    }));
    const kind = before.state !== after.state ? (after.state === 'closed' ? 'closed' : 'reopened') : changes.length ? 'changed' : null;
    if (kind) moved.push({ number, title: after.title, kind, changes });
  }
  return moved.sort((a, b) => order[a.kind] - order[b.kind] || b.number - a.number);
}

// Roles: who makes which change from the plugin. A guard against changing
// someone else's field by mistake, not a security boundary. Each team can
// change the split, per repository; 'both' is open to everyone.
const ACTIONS = {
  create: 'Create issues',
  size: 'Set sizes',
  title: 'Rename issues',
  milestone: 'Set milestones',
  parent: 'Move under a parent',
};
const DEFAULT_OWNERS = { create: 'pm', size: 'pm', title: 'pm', milestone: 'pm', parent: 'techlead' };

function canDo(role, action, owners = {}) {
  if (!role || role === 'both') return true;
  const owner = owners[action] || DEFAULT_OWNERS[action] || 'both';
  return owner === 'both' || owner === role;
}

// A starting story map, laid out like Figma's template: one labelled row
// each for the persona, the activities, the tasks and two releases, with an
// example sticky in each. Positions are relative to the top left corner.
const STICKY = 240;
const GAP = 60;
// The row labels are read back by ROW_KINDS and RELEASE_PATTERN, in both languages.
const STARTER_ROWS = [
  { label: 'User Persona', text: 'Who uses the product, and what they need', fill: { r: 0.85, g: 0.78, b: 1 } },
  { label: 'Activities', text: 'An activity: something the persona does', fill: { r: 0.6, g: 0.8, b: 1 } },
  { label: 'Tasks', text: 'A task within that activity', fill: { r: 1, g: 0.7, b: 0.7 } },
  { label: 'Release 1', text: 'A first story to build', fill: { r: 1, g: 0.86, b: 0.5 } },
  { label: 'Release 2', text: 'A story for later', fill: { r: 1, g: 0.86, b: 0.5 } },
];

function starterLayout() {
  const shapes = [];
  STARTER_ROWS.forEach((row, i) => {
    const y = i * (STICKY + GAP);
    shapes.push({ kind: 'label', text: t(row.label), x: 0, y, w: 120, h: STICKY, fill: { r: 0.95, g: 0.95, b: 0.95 } });
    shapes.push({ kind: 'sticky', text: t(row.text), x: 120 + GAP, y, w: STICKY, h: STICKY, fill: row.fill });
  });
  return shapes;
}

export {
  ACTIONS,
  DEFAULT_OWNERS,
  canDo,
  starterLayout,
  defaultBody,
  snapshotOf,
  changesSince,
  publishOrder,
  driftKey,
  draftIssue,
  TYPES, LEGEND_PATTERN, hexOf, hueName, buildPalette, defaultLegend, isReleaseLabel, findReleases, findRows, usesRows,
  buildBacklog, normalize, similarity, matchIssues, allItems, sameRelease, findDrift, explainEvents, parseProjectUrl,
  projectQuery, readProject, toMarkdown, suggestIssues, labelText,
};

// How far an issue is, from its column on the project board, whatever the
// team named it: 'done', 'active' (in progress or in review), 'waiting'
// (todo, ready, backlog...), or 'closed' when the issue itself is closed.
export function statusTone(status, state) {
  if (state === 'closed') return 'closed';
  if (/done|termin|fini|fait|shipped|released|livr/i.test(status || '')) return 'done';
  if (/progress|cours|review|revue|doing|testing|qa\b|blocked|bloqu/i.test(status || '')) return 'active';
  return 'waiting';
}

// The status filter of the tree: 'all', a column name, 'closed', or 'none'
// for a task not on GitHub yet.
export function matchesStatus(issue, filter) {
  if (filter === 'all') return true;
  if (filter === 'none') return !issue;
  if (!issue) return false;
  if (filter === 'closed') return issue.state === 'closed';
  return issue.state !== 'closed' && issue.status === filter;
}
