// Storymap to GitHub, the plugin code. It reads the current FigJam page,
// talks to GitHub, follows the selection, and, when asked, keeps a small
// label on every sticky that is linked to an issue.
import { emit, on, showUI } from '@create-figma-plugin/utilities'

import {
  LEGEND_PATTERN,
  buildBacklog,
  buildPalette,
  defaultLegend,
  draftIssue,
  explainEvents,
  findDrift,
  labelText,
  matchIssues,
  parseProjectUrl,
  projectQuery,
  readProject,
  toMarkdown,
} from './core'
import type { Backlog, BoardItem, Issue, ItemType, Matches, PaletteEntry, ProjectBoard, Publishing, RGB, ReadingMode, RepoMeta, Sprint } from './core'
import type {
  AuthHandler,
  AuthPayload,
  CancelSignInHandler,
  ProjectsHandler,
  ReposHandler,
  SaveTokenHandler,
  SelectProjectHandler,
  SelectRepoHandler,
  SignInHandler,
  BoardHandler,
  CompareHandler,
  FocusHandler,
  ForgetTokenHandler,
  LinkHandler,
  OpenHandler,
  PublishHandler,
  ReadyHandler,
  RefreshHandler,
  ResizeWindowHandler,
  SelectedHandler,
  SetGuideHandler,
  SetLabelsHandler,
  SetLegendHandler,
  SetModeHandler,
  SetPublishingHandler,
  SetWriteHandler,
  SetRowTypeHandler,
  StatusHandler,
  WhyHandler,
  WhyResultHandler,
  Guide,
} from './types'

// The plugin data key that marks the labels this plugin puts on the board.
// Its value is the id of the sticky the label belongs to.
const LABEL_KEY = 'storymap-label'

interface State {
  items: Array<BoardItem>
  palette: Array<PaletteEntry>
  legend: Record<string, ItemType>
  backlog: Backlog | null
  matches: Matches
  issues: Array<Issue> | null
  links: Record<string, number>
  repo: string
  project: string
  token: string
  login: string | null
  sprints: Array<Sprint>
  mode: ReadingMode
  rowTypes: Record<string, ItemType>
  nodeTypes: Record<string, number>
  labelsOn: boolean
  guide: Guide
  readAt: number | null
  meta: (RepoMeta & { canPush: boolean }) | null
  writeAllowed: boolean
  publishing: Publishing
}

// Generic starting values for a new issue; each team changes them in the
// GitHub tab, per repository.
const DEFAULT_PUBLISHING: Publishing = { startLabel: 'needs-refinement', startStatus: 'Backlog' }

const state: State = {
  items: [],
  palette: [],
  legend: {},
  backlog: null,
  matches: {},
  issues: null,
  links: {},
  repo: '',
  project: '',
  token: '',
  login: null,
  sprints: [],
  mode: 'auto',
  rowTypes: {},
  nodeTypes: {},
  labelsOn: false,
  guide: { readingConfirmed: false, hidden: false },
  readAt: null,
  meta: null,
  writeAllowed: false,
  publishing: { ...DEFAULT_PUBLISHING },
}

// Settings that belong to one board are stored under the file's name and
// an id kept in the file, so two files with the same name stay apart.
// (figma.fileKey would be simpler, but only private plugins may read it.)
const BOARD_ID_KEY = 'storymap-board-id'
let boardId = ''
const fileKey = (name: string) => `${name}:${figma.root.name}${boardId ? `:${boardId}` : ''}`

// Gives the file its id on first use, and moves the settings saved under
// the name alone, before the id existed, to their new key.
async function ensureBoardId() {
  boardId = figma.root.getPluginData(BOARD_ID_KEY)
  if (boardId) return
  const id = Math.random().toString(36).slice(2, 10)
  for (const name of ['repo', 'project', 'reading', 'labels', 'guide', 'links']) {
    const old = await figma.clientStorage.getAsync(`${name}:${figma.root.name}`)
    if (old === undefined) continue
    await figma.clientStorage.setAsync(`${name}:${figma.root.name}:${id}`, old)
    await figma.clientStorage.deleteAsync(`${name}:${figma.root.name}`)
  }
  figma.root.setPluginData(BOARD_ID_KEY, id)
  boardId = id
}

const solidFill = (node: StickyNode | ShapeWithTextNode): RGB | null => {
  const fills = node.fills
  if (!Array.isArray(fills)) return null
  const paint = fills.find((f: Paint) => f.type === 'SOLID' && f.visible !== false) as SolidPaint | undefined
  return paint ? { r: paint.color.r, g: paint.color.g, b: paint.color.b } : null
}

const isInLegend = (node: SceneNode) => {
  for (let p = node.parent; p && p.type !== 'PAGE'; p = p.parent) {
    if (p.type === 'SECTION' && LEGEND_PATTERN.test(p.name)) return true
  }
  return false
}

const isLabel = (node: BaseNode | RemovedNode) => 'getPluginData' in node && node.getPluginData(LABEL_KEY) !== ''

const toItem = (node: SceneNode): BoardItem => {
  const box = node.absoluteBoundingBox || { x: node.x, y: node.y, width: node.width, height: node.height }
  const item: BoardItem = { id: node.id, type: node.type, name: node.name, x: box.x, y: box.y, w: box.width, h: box.height }
  if (node.type === 'STICKY' || node.type === 'SHAPE_WITH_TEXT') {
    item.text = node.text.characters
    item.fill = solidFill(node)
    item.inLegend = isInLegend(node)
  } else if (node.type === 'TEXT') {
    item.text = node.characters
  } else if (node.type === 'CONNECTOR') {
    const start = node.connectorStart
    const end = node.connectorEnd
    item.from = 'endpointNodeId' in start ? start.endpointNodeId : null
    item.to = 'endpointNodeId' in end ? end.endpointNodeId : null
  }
  return item
}

const WANTED = new Set(['STICKY', 'SHAPE_WITH_TEXT', 'SECTION', 'TEXT', 'CONNECTOR', 'LINE'])

// Stickies of the page by id, kept from the last read, to read and write
// their links.
let stickies = new Map<string, StickyNode | ShapeWithTextNode>()

// The whole current page is read; the plugin's own labels are left out.
function readBoard() {
  const nodes = figma.currentPage.findAll((n) => WANTED.has(n.type) && !isLabel(n))
  state.nodeTypes = {}
  for (const n of figma.currentPage.findAll(() => true)) state.nodeTypes[n.type] = (state.nodeTypes[n.type] || 0) + 1
  state.items = nodes.map(toItem)
  state.palette = buildPalette(state.items)
  stickies = new Map()
  for (const n of nodes) if (n.type === 'STICKY' || n.type === 'SHAPE_WITH_TEXT') stickies.set(n.id, n)
  readLinks()
}

// Links between stickies and issues live in the file, on each sticky, as
// plugin data keyed by repository, so everyone on the board sees the same
// links and each repository keeps its own. The value is the issue number,
// or 0 for "not on GitHub yet".
const linkKey = () => `link:${state.repo.toLowerCase()}`

function readLinks() {
  state.links = {}
  if (!state.repo) return
  for (const [id, node] of stickies) {
    const value = node.getPluginData(linkKey())
    if (value !== '') state.links[id] = Number(value)
  }
}

function writeLink(id: string, number: number | null) {
  const node = stickies.get(id)
  if (!node || !state.repo) return
  node.setPluginData(linkKey(), number === null ? '' : String(number))
  if (number === null) delete state.links[id]
  else state.links[id] = number
}

// Links made before they lived in the file were kept on this computer only;
// they are moved onto the stickies once, for the repository then connected.
async function moveOldLinks() {
  const old = (await figma.clientStorage.getAsync(fileKey('links'))) as Record<string, number> | undefined
  if (!old || !state.repo) return
  for (const [id, number] of Object.entries(old)) if (stickies.get(id)?.getPluginData(linkKey()) === '') writeLink(id, number)
  await figma.clientStorage.deleteAsync(fileKey('links'))
}

async function loadSettings() {
  await ensureBoardId()
  const saved = ((await figma.clientStorage.getAsync('legend')) || {}) as Record<string, ItemType>
  state.legend = { ...defaultLegend(state.palette), ...saved }
  // Each board has its own repository and project board, so opening one
  // file never reads, or writes to, the repository of another.
  state.repo = (await figma.clientStorage.getAsync(fileKey('repo'))) || ''
  state.project = (await figma.clientStorage.getAsync(fileKey('project'))) || ''
  state.token = (await figma.clientStorage.getAsync('token')) || ''
  state.login = (await figma.clientStorage.getAsync('login')) || null
  await moveOldLinks()
  readLinks()
  const reading = (await figma.clientStorage.getAsync(fileKey('reading'))) || {}
  state.mode = reading.mode || 'auto'
  state.rowTypes = reading.rowTypes || {}
  state.labelsOn = Boolean(await figma.clientStorage.getAsync(fileKey('labels')))
  state.guide = { readingConfirmed: false, hidden: false, ...((await figma.clientStorage.getAsync(fileKey('guide'))) || {}) }
  await loadRepoSettings()
}

// Writing to GitHub is allowed per repository, off until the team turns it on.
const repoKey = (name: string) => `${name}:${state.repo.toLowerCase()}`

async function loadRepoSettings() {
  state.writeAllowed = Boolean(state.repo) && Boolean(await figma.clientStorage.getAsync(repoKey('write')))
  state.publishing = { ...DEFAULT_PUBLISHING, ...((await figma.clientStorage.getAsync(repoKey('publishing'))) || {}) }
}

const saveReading = () => figma.clientStorage.setAsync(fileKey('reading'), { mode: state.mode, rowTypes: state.rowTypes })

// The issue a backlog item is, when it is linked by hand or has the same title.
function linkedIssue(id: string): Issue | null {
  const m = state.matches[id]
  if (!m || !state.issues || (m.status !== 'linked' && m.status !== 'exists')) return null
  return state.issues.find((i) => i.number === m.number) || null
}

function publish() {
  state.backlog = buildBacklog(state.items, state.legend, { mode: state.mode, rowTypes: state.rowTypes })
  state.matches = state.issues ? matchIssues(state.backlog, state.issues, state.links) : {}
  emit<BoardHandler>('BOARD', {
    page: figma.currentPage.name,
    palette: state.palette,
    legend: state.legend,
    backlog: state.backlog,
    matches: state.matches,
    issues: (state.issues || []).map((i) => ({
      number: i.number,
      title: i.title,
      url: i.html_url,
      state: i.state,
      sprint: i.sprint ? i.sprint.title : null,
      status: i.status || null,
      size: i.size || null,
      assignees: i.assignees || [],
    })),
    sprints: state.sprints,
    drift: state.issues ? findDrift(state.backlog, state.issues, state.matches) : null,
    nodeTypes: state.nodeTypes,
    markdown: toMarkdown(state.backlog, state.matches),
    labelsOn: state.labelsOn,
    guide: state.guide,
    readAt: state.readAt,
    settings: {
      repo: state.repo,
      project: state.project,
      mode: state.mode,
      hasToken: Boolean(state.token),
      login: state.login,
      issuesLoaded: state.issues ? state.issues.length : null,
      meta: state.meta,
      writeAllowed: state.writeAllowed,
      publishing: state.publishing,
    },
  })
  void syncLabels()
}

// GitHub ------------------------------------------------------------------

const githubHeaders = (): Record<string, string> => {
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json' }
  if (state.token) headers.Authorization = `Bearer ${state.token}`
  return headers
}

interface RawIssue {
  number: number
  title: string
  html_url: string
  state: string
  state_reason?: string | null
  pull_request?: unknown
  type?: { name: string } | null
  milestone?: { title: string; due_on?: string | null } | null
  parent_issue_url?: string | null
  assignees?: Array<{ login: string }>
  labels?: Array<{ name: string }>
}

async function fetchIssues(): Promise<Array<Issue>> {
  if (!/^[\w.-]+\/[\w.-]+$/.test(state.repo)) throw new Error('Enter the repository as owner/name.')
  const all: Array<Issue> = []
  for (let page = 1; page <= 10; page += 1) {
    const res = await fetch(`https://api.github.com/repos/${state.repo}/issues?state=all&per_page=100&page=${page}`, { headers: githubHeaders() })
    if (!res.ok) {
      if (res.status === 404) throw new Error(`Repository ${state.repo} not found, or private without a token.`)
      if (res.status === 401) throw new Error('GitHub refused the token.')
      if (res.status === 403) throw new Error('GitHub rate limit reached. Add a token or retry later.')
      throw new Error(`GitHub answered ${res.status}.`)
    }
    const batch = (await res.json()) as Array<RawIssue>
    for (const i of batch) {
      if (i.pull_request) continue
      all.push({
        number: i.number,
        title: i.title,
        html_url: i.html_url,
        state: i.state,
        state_reason: i.state_reason || null,
        type: i.type ? i.type.name : null,
        milestone: i.milestone ? i.milestone.title : null,
        milestoneDue: i.milestone && i.milestone.due_on ? i.milestone.due_on.slice(0, 10) : null,
        parent: i.parent_issue_url ? Number(i.parent_issue_url.split('/').pop()) : null,
        assignees: (i.assignees || []).map((a) => a.login),
        labels: (i.labels || []).map((l) => l.name),
      })
    }
    if (batch.length < 100) break
  }
  return all
}

// Sprints live in a GitHub Projects board, read through GraphQL, which
// always needs a token (read access to projects).
async function fetchProject(): Promise<ProjectBoard> {
  const target = parseProjectUrl(state.project)
  if (!target) throw new Error('Paste the project board address, like https://github.com/orgs/acme/projects/12.')
  if (!state.token) throw new Error('Reading sprints needs a token that can read projects (classic token: read:project).')
  const pages: Array<unknown> = []
  let cursor: string | null = null
  do {
    const res = await fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers: { Authorization: `Bearer ${state.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: projectQuery(target.kind), variables: { owner: target.owner, number: target.number, cursor } }),
    })
    const body = (await res.json()) as {
      data?: { owner?: { projectV2?: { items: { pageInfo: { hasNextPage: boolean; endCursor: string } } } } }
      errors?: Array<{ message: string }>
    }
    const project = body.data && body.data.owner && body.data.owner.projectV2
    if (!res.ok || !project) throw new Error(`Could not read the project board${body.errors ? `: ${body.errors[0].message}` : '.'}`)
    pages.push(project)
    cursor = project.items.pageInfo.hasNextPage ? project.items.pageInfo.endCursor : null
  } while (cursor && pages.length < 20)
  return readProject(pages)
}

// What a new issue can carry in this repository: the owner's issue types,
// the milestones, and whether the token may write at all.
async function fetchMeta(): Promise<RepoMeta & { canPush: boolean }> {
  const owner = state.repo.split('/')[0]
  const get = async (path: string) => {
    const res = await fetch(`https://api.github.com/${path}`, { headers: githubHeaders() })
    return res.ok ? res.json() : null
  }
  const [repo, milestones, types] = await Promise.all([
    get(`repos/${state.repo}`),
    get(`repos/${state.repo}/milestones?state=all&per_page=100`),
    get(`orgs/${owner}/issue-types`),
  ])
  return {
    canPush: Boolean(repo && repo.permissions && repo.permissions.push),
    milestones: ((milestones || []) as Array<{ title: string; number: number }>).map((m) => ({ title: m.title, number: m.number })),
    types: ((types || []) as Array<{ name: string }>).map((t) => t.name),
  }
}

async function graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `Bearer ${state.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  })
  const body = (await res.json()) as { data?: T; errors?: Array<{ message: string }> }
  if (!res.ok || body.errors || !body.data) throw new Error(body.errors ? body.errors[0].message : `GitHub answered ${res.status}.`)
  return body.data
}

// Adds an issue to the project board and sets its starting status, when the
// board has that status. Returns what was done, for the message.
async function addToProject(nodeId: string, status: string | null): Promise<string> {
  const target = parseProjectUrl(state.project)
  if (!target) return ''
  const data = await graphql<{ owner: { projectV2: { id: string; field: { id: string; options: Array<{ id: string; name: string }> } | null } } }>(
    `query($owner: String!, $number: Int!) { owner: ${target.kind}(login: $owner) { projectV2(number: $number) { id field(name: "Status") { ... on ProjectV2SingleSelectField { id options { id name } } } } } }`,
    { owner: target.owner, number: target.number },
  )
  const project = data.owner.projectV2
  const added = await graphql<{ addProjectV2ItemById: { item: { id: string } } }>(
    'mutation($project: ID!, $content: ID!) { addProjectV2ItemById(input: { projectId: $project, contentId: $content }) { item { id } } }',
    { project: project.id, content: nodeId },
  )
  if (!status) return ' Added to the board.'
  const option = project.field && project.field.options.find((o) => o.name.toLowerCase() === status.toLowerCase())
  if (!project.field || !option) return ` Added to the board, without status: it has no "${status}" status.`
  await graphql(
    'mutation($project: ID!, $item: ID!, $field: ID!, $option: String!) { updateProjectV2ItemFieldValue(input: { projectId: $project, itemId: $item, fieldId: $field, value: { singleSelectOptionId: $option } }) { projectV2Item { id } } }',
    { project: project.id, item: added.addProjectV2ItemById.item.id, field: project.field.id, option: option.id },
  )
  return ` Added to the board in ${option.name}.`
}

// Publishes one sticky as an issue: the issue, its place under its parent,
// the project board, then the link on the sticky. Only when the team allowed
// writing to this repository.
async function publishSticky(id: string, title: string) {
  if (!state.writeAllowed) throw new Error(`Changes to ${state.repo} are not allowed. Turn them on in the GitHub tab.`)
  if (!state.token) throw new Error('Publishing needs a token that can write issues.')
  if (!state.backlog || !state.meta) throw new Error('Compare with GitHub first.')
  const draft = draftIssue(id, state.backlog, state.matches, state.meta, state.publishing)
  if (!draft) throw new Error('This sticky is already an issue.')
  const name = title.trim() || draft.title
  emit<StatusHandler>('STATUS', { state: 'loading', text: `Creating "${name}" in ${state.repo}…` })
  const res = await fetch(`https://api.github.com/repos/${state.repo}/issues`, {
    method: 'POST',
    headers: { ...githubHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: name,
      body: draft.body,
      labels: draft.labels,
      ...(draft.milestone ? { milestone: draft.milestone.number } : {}),
      ...(draft.type ? { type: draft.type } : {}),
    }),
  })
  if (!res.ok) {
    const detail = ((await res.json().catch(() => ({}))) as { message?: string }).message
    throw new Error(`GitHub refused the issue (${res.status}${detail ? `: ${detail}` : ''}).`)
  }
  const made = (await res.json()) as RawIssue & { id: number; node_id: string }
  writeLink(id, made.number)
  let note = `#${made.number} created.`
  const problems: Array<string> = []
  if (draft.parent && draft.parent.number) {
    const sub = await fetch(`https://api.github.com/repos/${state.repo}/issues/${draft.parent.number}/sub_issues`, {
      method: 'POST',
      headers: { ...githubHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ sub_issue_id: made.id }),
    })
    if (sub.ok) note += ` Sub-issue of #${draft.parent.number}.`
    else problems.push(`not made a sub-issue of #${draft.parent.number} (GitHub answered ${sub.status})`)
  }
  if (state.project) {
    try {
      note += await addToProject(made.node_id, draft.status)
    } catch (err) {
      problems.push(`not added to the board (${err instanceof Error ? err.message : String(err)})`)
    }
  }
  // Read GitHub again, so the tree, the labels and drift show the new issue.
  await compare()
  emit<StatusHandler>('STATUS', { state: problems.length ? 'warn' : 'ok', text: problems.length ? `${note} But ${problems.join(', ')}.` : note })
}

const withProject = (issues: Array<Issue>, project: ProjectBoard): Array<Issue> =>
  issues.map((i) => ({ ...i, ...(project.items[`${state.repo}#${i.number}`.toLowerCase()] || {}) }))

// Labels on the board ------------------------------------------------------
// A label is a small locked shape in the bottom right corner of a linked
// sticky, in the same parent, marked with LABEL_KEY. The plugin is the only
// one to change it: its text follows the issue, its place follows the sticky.

const LABEL_HEIGHT = 28
const labelWidth = (text: string) => Math.max(56, Math.round(text.length * 7.2 + 20))

function placeLabel(label: ShapeWithTextNode, sticky: SceneNode) {
  label.x = sticky.x + sticky.width - label.width - 8
  label.y = sticky.y + sticky.height - label.height - 8
}

let syncing = false

async function syncLabels() {
  if (syncing) return
  syncing = true
  try {
    const existing = new Map<string, ShapeWithTextNode>()
    for (const node of figma.currentPage.findAll(isLabel)) {
      if (node.type === 'SHAPE_WITH_TEXT') existing.set(node.getPluginData(LABEL_KEY), node)
      else node.remove()
    }
    const wanted = new Map<string, string>()
    if (state.labelsOn && state.backlog && state.issues) {
      for (const [id] of Object.entries(state.matches)) {
        const issue = linkedIssue(id)
        if (issue) wanted.set(id, labelText(issue))
      }
    }
    for (const [stickyId, label] of existing) {
      if (!wanted.has(stickyId)) label.remove()
    }
    for (const [stickyId, text] of wanted) {
      const sticky = await figma.getNodeByIdAsync(stickyId)
      if (!sticky || sticky.type === 'PAGE' || sticky.type === 'DOCUMENT' || !sticky.parent) continue
      let label = existing.get(stickyId)
      if (!label) {
        label = figma.createShapeWithText()
        label.shapeType = 'ROUNDED_RECTANGLE'
        label.name = 'Storymap to GitHub label'
        label.setPluginData(LABEL_KEY, stickyId)
        label.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }]
        label.strokes = [{ type: 'SOLID', color: { r: 0.55, g: 0.55, b: 0.6 } }]
        await figma.loadFontAsync(label.text.fontName as FontName)
        label.text.fontSize = 12
        sticky.parent.appendChild(label)
      } else {
        await figma.loadFontAsync(label.text.fontName as FontName)
        if (label.parent !== sticky.parent) sticky.parent.appendChild(label)
      }
      label.locked = false
      if (label.text.characters !== text) label.text.characters = text
      label.resize(labelWidth(text), LABEL_HEIGHT)
      placeLabel(label, sticky as SceneNode)
      label.locked = true
    }
  } finally {
    syncing = false
  }
}

// When a labelled sticky moves, its label follows.
let moveTimer: number | null = null
function onPageChange(event: NodeChangeEvent) {
  if (!state.labelsOn) return
  const moved = event.nodeChanges.some((c) => c.type === 'PROPERTY_CHANGE' && !isLabel(c.node) && c.properties.some((p) => p === 'x' || p === 'y' || p === 'width' || p === 'height'))
  if (!moved) return
  if (moveTimer !== null) clearTimeout(moveTimer)
  moveTimer = setTimeout(() => {
    moveTimer = null
    void (async () => {
      for (const label of figma.currentPage.findAll(isLabel)) {
        const sticky = await figma.getNodeByIdAsync(label.getPluginData(LABEL_KEY))
        if (label.type !== 'SHAPE_WITH_TEXT' || !sticky || sticky.type === 'PAGE' || sticky.type === 'DOCUMENT') continue
        label.locked = false
        placeLabel(label, sticky as SceneNode)
        label.locked = true
      }
    })()
  }, 300)
}

// Selection -----------------------------------------------------------------
// Hovering a row in the panel selects its sticky; selecting a sticky on the
// board opens its card in the panel. Selections made by the plugin itself
// are not sent back.

let selectingFromPanel = false

async function selectNode(id: string, zoom: boolean) {
  const node = await figma.getNodeByIdAsync(id)
  if (!node || node.type === 'PAGE' || node.type === 'DOCUMENT') return
  selectingFromPanel = true
  figma.currentPage.selection = [node as SceneNode]
  if (zoom) figma.viewport.scrollAndZoomIntoView([node as SceneNode])
}

function onSelectionChange() {
  if (selectingFromPanel) {
    selectingFromPanel = false
    return
  }
  const selection = figma.currentPage.selection
  let id: string | null = selection.length === 1 ? selection[0].id : null
  if (selection.length === 1 && isLabel(selection[0])) id = selection[0].getPluginData(LABEL_KEY)
  emit<SelectedHandler>('SELECTED', id)
}

// Signing in ---------------------------------------------------------------
// GitHub's device flow: the plugin gets a short code, the person enters it
// on github.com/login/device and authorizes, and the plugin polls until
// GitHub hands over a token. The calls go through a small relay because
// GitHub's sign-in endpoints refuse calls from a browser window (no CORS);
// the relay keeps nothing (relay/index.js).
const RELAY = 'https://storymap-auth.storymap-authmemolabsworkersdev.workers.dev'

let signInRun = 0

const sendAuth = (auth: AuthPayload) => emit<AuthHandler>('AUTH', auth)

async function relay(path: string, body: Record<string, string> = {}) {
  const res = await fetch(`${RELAY}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return (await res.json()) as Record<string, unknown>
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function signIn() {
  const run = (signInRun += 1)
  sendAuth({ state: 'starting' })
  const code = await relay('/device/code')
  if (run !== signInRun) return
  if (!code.device_code) throw new Error(`GitHub did not start the sign-in (${String(code.error || 'no answer')}).`)
  const url = String(code.verification_uri)
  sendAuth({ state: 'code', userCode: String(code.user_code), url })
  let interval = Number(code.interval || 5) * 1000
  const deadline = Date.now() + Number(code.expires_in || 900) * 1000
  while (run === signInRun && Date.now() < deadline) {
    await wait(interval)
    if (run !== signInRun) return
    const answer = await relay('/token', { device_code: String(code.device_code) })
    if (run !== signInRun) return
    if (answer.access_token) {
      await useToken(String(answer.access_token))
      sendAuth({ state: 'idle' })
      return
    }
    const error = String(answer.error || '')
    if (error === 'authorization_pending') continue
    if (error === 'slow_down') {
      interval = Number(answer.interval || interval / 1000 + 5) * 1000
      continue
    }
    if (error === 'access_denied') return sendAuth({ state: 'error', error: 'Sign-in was cancelled on GitHub.' })
    return sendAuth({ state: 'error', error: `GitHub stopped the sign-in (${error || 'no answer'}).` })
  }
  if (run === signInRun) sendAuth({ state: 'error', error: 'The code expired. Start again.' })
}

// Keeps a token, from the sign-in or pasted, and finds whose it is.
// A token GitHub refuses is never saved.
async function useToken(token: string) {
  const res = await fetch('https://api.github.com/user', { headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error('GitHub refused this token.')
  state.token = token
  state.login = ((await res.json()) as { login: string }).login
  await figma.clientStorage.setAsync('token', token)
  await figma.clientStorage.setAsync('login', state.login)
  publish()
  await listRepos()
  // The board's repository, if one was picked before, is read again at once.
  if (state.repo) {
    await listProjects()
    await compare()
  }
}

// The repositories the account can see, most recently pushed first.
async function listRepos() {
  if (!state.token) return
  const repos: Array<{ name: string; private: boolean }> = []
  for (let page = 1; page <= 3; page += 1) {
    const res = await fetch(`https://api.github.com/user/repos?per_page=100&sort=pushed&page=${page}`, { headers: githubHeaders() })
    if (!res.ok) break
    const batch = (await res.json()) as Array<{ full_name: string; private: boolean }>
    repos.push(...batch.map((r) => ({ name: r.full_name, private: r.private })))
    if (batch.length < 100) break
  }
  emit<ReposHandler>('REPOS', repos)
}

// The open project boards linked to the repository.
async function listProjects(): Promise<Array<{ title: string; url: string }>> {
  if (!state.token || !state.repo) return []
  const [owner, name] = state.repo.split('/')
  const data = await graphql<{ repository: { projectsV2: { nodes: Array<{ title: string; url: string; closed: boolean }> } } | null }>(
    'query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { projectsV2(first: 20) { nodes { title url closed } } } }',
    { owner, name },
  ).catch(() => null)
  const projects = data && data.repository ? data.repository.projectsV2.nodes.filter((p) => !p.closed).map((p) => ({ title: p.title, url: p.url })) : []
  emit<ProjectsHandler>('PROJECTS', projects)
  return projects
}

// Picking a repository connects the board to it at once; its project board
// is picked too when it has exactly one.
async function selectRepo(repo: string) {
  state.repo = repo.trim()
  readLinks()
  await loadRepoSettings()
  emit<ProjectsHandler>('PROJECTS', null)
  const projects = await listProjects()
  const saved = (await figma.clientStorage.getAsync(fileKey('repo'))) === state.repo ? state.project : ''
  state.project = saved && projects.some((p) => p.url === saved) ? saved : projects.length === 1 ? projects[0].url : ''
  await figma.clientStorage.setAsync(fileKey('repo'), state.repo)
  await figma.clientStorage.setAsync(fileKey('project'), state.project)
  await compare()
}

// Reads the issues of the connected repository, and the sprints of its
// project board when one is named, then shows the result.
async function compare() {
  emit<StatusHandler>('STATUS', { state: 'loading', text: `Reading issues of ${state.repo}…` })
  state.issues = await fetchIssues()
  state.meta = await fetchMeta()
  // Listing the owner's issue types needs read:org; the types the issues
  // already use are known without it.
  for (const i of state.issues) if (i.type && !state.meta.types.includes(i.type)) state.meta.types.push(i.type)
  let note = `${state.issues.length} issues read from ${state.repo}.`
  let warn = false
  state.sprints = []
  if (state.project) {
    try {
      const board = await fetchProject()
      state.issues = withProject(state.issues, board)
      state.sprints = board.sprints
      note += ` Sprints read from "${board.title}" (${board.sprints.length}).`
    } catch (err) {
      warn = true
      note += ` Sprints not read: ${err instanceof Error ? err.message : String(err)}`
    }
  }
  state.readAt = Date.now()
  publish()
  emit<StatusHandler>('STATUS', { state: warn ? 'warn' : 'ok', text: note })
}

// Commands from the panel ----------------------------------------------------

const fail =(err: unknown) => emit<StatusHandler>('STATUS', { state: 'error', text: err instanceof Error ? err.message : String(err) })

export default function () {
  on<ReadyHandler>('READY', () => {
    void (async () => {
      readBoard()
      await loadSettings()
      publish()
      onSelectionChange()
      // Once a repository is connected, it is read again at every opening,
      // so the map shows GitHub's state without pressing anything.
      if (state.token) void listRepos().catch(() => undefined)
      if (state.repo) {
        void listProjects().catch(() => undefined)
        await compare()
      }
    })().catch(fail)
  })

  on<SetGuideHandler>('SET_GUIDE', (change) => {
    state.guide = { ...state.guide, ...change }
    void figma.clientStorage.setAsync(fileKey('guide'), state.guide).then(publish).catch(fail)
  })

  on<RefreshHandler>('REFRESH', () => {
    readBoard()
    publish()
  })

  on<SetModeHandler>('SET_MODE', (mode) => {
    state.mode = mode
    void saveReading().then(publish).catch(fail)
  })

  on<SetRowTypeHandler>('SET_ROW_TYPE', (row, value) => {
    state.rowTypes[row] = value
    void saveReading().then(publish).catch(fail)
  })

  on<SetLegendHandler>('SET_LEGEND', (hex, value) => {
    state.legend[hex] = value
    void (async () => {
      const saved = ((await figma.clientStorage.getAsync('legend')) || {}) as Record<string, ItemType>
      saved[hex] = value
      await figma.clientStorage.setAsync('legend', saved)
      publish()
    })().catch(fail)
  })

  on<FocusHandler>('FOCUS', (id, zoom) => {
    void selectNode(id, zoom).catch(fail)
  })

  on<CompareHandler>('COMPARE', (repo, project, token) => {
    void (async () => {
      state.repo = repo.trim()
      state.project = project.trim()
      if (token) state.token = token.trim()
      await figma.clientStorage.setAsync(fileKey('repo'), state.repo)
      await figma.clientStorage.setAsync(fileKey('project'), state.project)
      if (token) await figma.clientStorage.setAsync('token', state.token)
      readLinks()
      await loadRepoSettings()
      await compare()
    })().catch(fail)
  })

  on<SignInHandler>('SIGN_IN', () => {
    void signIn().catch((err) => sendAuth({ state: 'error', error: err instanceof Error ? err.message : String(err) }))
  })

  on<CancelSignInHandler>('CANCEL_SIGN_IN', () => {
    signInRun += 1
    sendAuth({ state: 'idle' })
  })

  on<SaveTokenHandler>('SAVE_TOKEN', (token) => {
    void useToken(token.trim()).catch(fail)
  })

  on<SelectRepoHandler>('SELECT_REPO', (repo) => {
    void selectRepo(repo).catch(fail)
  })

  on<SelectProjectHandler>('SELECT_PROJECT', (url) => {
    void (async () => {
      state.project = url
      await figma.clientStorage.setAsync(fileKey('project'), url)
      await compare()
    })().catch(fail)
  })

  on<WhyHandler>('WHY', (key, number, kind) => {
    void (async () => {
      const res = await fetch(`https://api.github.com/repos/${state.repo}/issues/${number}/events?per_page=100`, { headers: githubHeaders() })
      const lines = res.ok ? explainEvents((await res.json()) as Array<unknown>, kind) : null
      emit<WhyResultHandler>('WHY_RESULT', key, lines, res.ok ? null : `GitHub answered ${res.status}.`)
    })().catch(fail)
  })

  on<OpenHandler>('OPEN', (url) => {
    if (/^https:\/\/github\.com\//.test(url)) figma.openExternal(url)
  })

  on<LinkHandler>('LINK', (id, number) => {
    writeLink(id, number)
    publish()
  })

  // Signing out forgets the token and what was read with it. The token stays
  // valid on GitHub until revoked at github.com/settings/applications: only
  // the app's secret could revoke it, and the plugin has none.
  on<ForgetTokenHandler>('FORGET_TOKEN', () => {
    state.token = ''
    state.login = null
    state.issues = null
    state.meta = null
    state.sprints = []
    state.readAt = null
    emit<ReposHandler>('REPOS', [])
    emit<ProjectsHandler>('PROJECTS', null)
    void (async () => {
      await figma.clientStorage.deleteAsync('token')
      await figma.clientStorage.deleteAsync('login')
      publish()
      emit<StatusHandler>('STATUS', { state: 'ok', text: 'Signed out. The token is forgotten on this computer.' })
    })().catch(fail)
  })

  on<SetLabelsHandler>('SET_LABELS', (labelsOn) => {
    state.labelsOn = labelsOn
    void figma.clientStorage.setAsync(fileKey('labels'), labelsOn).then(publish).catch(fail)
  })

  on<SetWriteHandler>('SET_WRITE', (allowed) => {
    if (!state.repo) return
    state.writeAllowed = allowed
    void figma.clientStorage.setAsync(repoKey('write'), allowed).then(publish).catch(fail)
  })

  on<SetPublishingHandler>('SET_PUBLISHING', (change) => {
    if (!state.repo) return
    state.publishing = { ...state.publishing, ...change }
    void figma.clientStorage.setAsync(repoKey('publishing'), state.publishing).then(publish).catch(fail)
  })

  on<PublishHandler>('PUBLISH', (id, title) => {
    void publishSticky(id, title).catch(fail)
  })

  on<ResizeWindowHandler>('RESIZE_WINDOW', ({ width, height }) => figma.ui.resize(width, height))

  figma.on('selectionchange', onSelectionChange)
  figma.currentPage.on('nodechange', onPageChange)

  showUI({ width: 420, height: 680, title: 'Storymap to GitHub' })
}
