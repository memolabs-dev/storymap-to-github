// Storymap to GitHub, a FigJam plugin.
// Reads a user story map and previews the GitHub backlog it would become:
// epics, features with their steps, tasks and milestones. It writes nothing,
// neither to GitHub nor to the board.
//
// One file on purpose: the pure functions at the top run both in Figma and in
// node:test (see test/), the Figma glue at the bottom only runs in Figma.

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

// Turn the raw board items into the backlog tree.
// items: [{ id, type, text, name, fill, x, y, w, h, inLegend }] and connectors
//        [{ id, type: 'CONNECTOR', from, to }]
// legend: { '#rrggbb': type }
function buildBacklog(items, legend) {
  const typed = { epic: [], feature: [], step: [], task: [], note: [] };
  let ignored = 0;
  const unmapped = new Set();
  for (const item of items) {
    if (item.type !== 'STICKY' && item.type !== 'SHAPE_WITH_TEXT') continue;
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
    const task = { ...raw, release: releaseOf(raw, releases), subtasks: [] };
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
  const names = [...releases.sections.map((s) => s.name), ...rowNames];
  const milestones = [...new Set(names)];
  const tasks = [...taskById.values()];

  return {
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

// A Markdown draft of the backlog, to paste into an issue or a note.
function toMarkdown(backlog, matches = {}) {
  const ref = (item) => {
    const m = matches[item.id];
    return m && m.number ? ` (#${m.number}${m.status === 'maybe' ? '?' : ''})` : '';
  };
  const lines = [];
  const task = (t, depth = 1) => {
    lines.push(`${'  '.repeat(depth)}- [ ] ${depth > 1 ? 'Sub-task' : 'Task'}: ${t.title}${t.release ? ` · ${t.release}` : ''}${ref(t)}`);
    for (const s of t.subtasks || []) task(s, depth + 1);
  };
  const feature = (f, indent) => {
    lines.push(`${indent}- Feature: ${f.title}${ref(f)}`);
    for (const s of f.steps) lines.push(`${indent}  - Step: ${s.title}`);
    f.tasks.forEach((t) => task(t));
  };
  for (const epic of backlog.epics) {
    lines.push(`## Epic: ${epic.title}${ref(epic)}`, '');
    for (const f of epic.features) feature(f, '');
    epic.tasks.forEach((t) => task(t));
    lines.push('');
  }
  for (const f of backlog.looseFeatures) feature(f, '');
  if (backlog.milestones.length) lines.push('', `Milestones: ${backlog.milestones.join(', ')}`);
  return lines.join('\n').trim() + '\n';
}

if (typeof module !== 'undefined') {
  module.exports = { TYPES, hexOf, hueName, buildPalette, defaultLegend, isReleaseLabel, findReleases, buildBacklog, normalize, similarity, matchIssues, allItems, toMarkdown };
}

// ---------------------------------------------------------------------------
// Figma glue. Runs only inside Figma.
// ---------------------------------------------------------------------------

if (typeof figma !== 'undefined') {
  const state = { items: [], palette: [], legend: {}, backlog: null, matches: {}, issues: null, links: {}, scope: 'page' };
  // Hand-made links between stickies and issues stay on this computer
  // (clientStorage), keyed by file name, so the board itself is not changed.
  const linksKey = () => `links:${figma.root.name}`;

  const solidFill = (node) => {
    const fills = node.fills;
    if (!Array.isArray(fills)) return null;
    const paint = fills.find((f) => f.type === 'SOLID' && f.visible !== false);
    return paint ? { r: paint.color.r, g: paint.color.g, b: paint.color.b } : null;
  };

  const isInLegend = (node) => {
    for (let p = node.parent; p && p.type !== 'PAGE'; p = p.parent) {
      if (p.type === 'SECTION' && LEGEND_PATTERN.test(p.name)) return true;
    }
    return false;
  };

  const toItem = (node) => {
    const box = node.absoluteBoundingBox || { x: node.x, y: node.y, width: node.width, height: node.height };
    const item = { id: node.id, type: node.type, name: node.name, x: box.x, y: box.y, w: box.width, h: box.height };
    if (node.type === 'STICKY' || node.type === 'SHAPE_WITH_TEXT') {
      item.text = node.text.characters;
      item.fill = solidFill(node);
      item.inLegend = isInLegend(node);
    } else if (node.type === 'TEXT') {
      item.text = node.characters;
    } else if (node.type === 'CONNECTOR') {
      item.from = node.connectorStart && node.connectorStart.endpointNodeId;
      item.to = node.connectorEnd && node.connectorEnd.endpointNodeId;
    }
    return item;
  };

  const WANTED = new Set(['STICKY', 'SHAPE_WITH_TEXT', 'SECTION', 'TEXT', 'CONNECTOR', 'LINE']);

  const readBoard = () => {
    const selection = figma.currentPage.selection;
    let nodes = [];
    if (selection.length) {
      state.scope = 'selection';
      for (const node of selection) {
        if (WANTED.has(node.type)) nodes.push(node);
        if ('findAll' in node) nodes.push(...node.findAll((n) => WANTED.has(n.type)));
      }
    } else {
      state.scope = 'page';
      nodes = figma.currentPage.findAll((n) => WANTED.has(n.type));
    }
    // What the page is made of, shown in the Legend tab to explain a reading.
    state.nodeTypes = {};
    for (const n of figma.currentPage.findAll(() => true)) state.nodeTypes[n.type] = (state.nodeTypes[n.type] || 0) + 1;
    state.items = nodes.map(toItem);
    state.palette = buildPalette(state.items);
  };

  const loadSettings = async () => {
    const saved = (await figma.clientStorage.getAsync('legend')) || {};
    state.legend = { ...defaultLegend(state.palette), ...saved };
    state.repo = (await figma.clientStorage.getAsync('repo')) || '';
    state.token = (await figma.clientStorage.getAsync('token')) || '';
    state.links = (await figma.clientStorage.getAsync(linksKey())) || {};
  };

  const publish = () => {
    state.backlog = buildBacklog(state.items, state.legend);
    state.matches = state.issues ? matchIssues(state.backlog, state.issues, state.links) : {};
    figma.ui.postMessage({
      type: 'board',
      scope: state.scope,
      page: figma.currentPage.name,
      palette: state.palette,
      legend: state.legend,
      backlog: state.backlog,
      matches: state.matches,
      issues: state.issues ? state.issues.map((i) => ({ number: i.number, title: i.title })) : [],
      nodeTypes: state.nodeTypes,
      markdown: toMarkdown(state.backlog, state.matches),
      settings: { repo: state.repo, hasToken: Boolean(state.token), issuesLoaded: state.issues ? state.issues.length : null },
    });
  };

  const fetchIssues = async () => {
    if (!/^[\w.-]+\/[\w.-]+$/.test(state.repo)) throw new Error('Enter the repository as owner/name.');
    const headers = { Accept: 'application/vnd.github+json' };
    if (state.token) headers.Authorization = `Bearer ${state.token}`;
    const all = [];
    for (let page = 1; page <= 10; page += 1) {
      const res = await fetch(`https://api.github.com/repos/${state.repo}/issues?state=all&per_page=100&page=${page}`, { headers });
      if (!res.ok) {
        if (res.status === 404) throw new Error(`Repository ${state.repo} not found, or private without a token.`);
        if (res.status === 401) throw new Error('GitHub refused the token.');
        if (res.status === 403) throw new Error('GitHub rate limit reached. Add a token or retry later.');
        throw new Error(`GitHub answered ${res.status}.`);
      }
      const batch = await res.json();
      all.push(...batch.filter((i) => !i.pull_request).map((i) => ({ number: i.number, title: i.title, html_url: i.html_url, state: i.state, type: i.type ? i.type.name : null })));
      if (batch.length < 100) break;
    }
    return all;
  };

  figma.showUI(__html__, { width: 420, height: 680, themeColors: true, title: 'Storymap to GitHub' });

  figma.ui.onmessage = async (msg) => {
    try {
      if (msg.type === 'ready' || msg.type === 'refresh') {
        readBoard();
        await loadSettings();
        publish();
      } else if (msg.type === 'set-legend') {
        state.legend[msg.hex] = msg.value;
        const saved = (await figma.clientStorage.getAsync('legend')) || {};
        saved[msg.hex] = msg.value;
        await figma.clientStorage.setAsync('legend', saved);
        publish();
      } else if (msg.type === 'focus') {
        const node = await figma.getNodeByIdAsync(msg.id);
        if (node && node.type !== 'PAGE' && node.type !== 'DOCUMENT') figma.viewport.scrollAndZoomIntoView([node]);
      } else if (msg.type === 'compare') {
        state.repo = (msg.repo || '').trim();
        if (typeof msg.token === 'string' && msg.token) state.token = msg.token.trim();
        await figma.clientStorage.setAsync('repo', state.repo);
        if (msg.token) await figma.clientStorage.setAsync('token', state.token);
        figma.ui.postMessage({ type: 'status', state: 'loading', text: `Reading issues of ${state.repo}…` });
        state.issues = await fetchIssues();
        publish();
        figma.ui.postMessage({ type: 'status', state: 'ok', text: `${state.issues.length} issues read from ${state.repo}.` });
      } else if (msg.type === 'link') {
        if (msg.number === null) delete state.links[msg.id];
        else state.links[msg.id] = msg.number;
        await figma.clientStorage.setAsync(linksKey(), state.links);
        publish();
      } else if (msg.type === 'forget-token') {
        state.token = '';
        await figma.clientStorage.deleteAsync('token');
        publish();
      }
    } catch (err) {
      figma.ui.postMessage({ type: 'status', state: 'error', text: err.message || String(err) });
    }
  };

  figma.on('selectionchange', () => figma.ui.postMessage({ type: 'selection-changed', count: figma.currentPage.selection.length }));
}
