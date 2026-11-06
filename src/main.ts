// Storymap to GitHub, the plugin code. It reads the current FigJam page,
// talks to GitHub, follows the selection, and, when asked, keeps a small
// label on every sticky that is linked to an issue.
import { emit, on, showUI } from '@create-figma-plugin/utilities'

import {
  LEGEND_PATTERN,
  buildBacklog,
  buildPalette,
  DEFAULT_OWNERS,
  canDo,
  changesSince,
  starterLayout,
  defaultLegend,
  draftIssue,
  snapshotOf,
  driftKey,
  publishOrder,
  sameRelease,
  explainEvents,
  findDrift,
  labelText,
  matchIssues,
  parseIssueTemplate,
  parseProjectUrl,
  pickTemplate,
  projectQuery,
  readProject,
  toMarkdown,
} from './core'
import { getLang, plural, resolveLang, setLang, t } from './i18n'
import type { LangSetting } from './i18n'
import type { Action, Backlog, BoardItem, Role, Issue, IssueTemplate, ItemType, Matches, PaletteEntry, ProjectBoard, Publishing, RGB, ReadingMode, RepoMeta, Sprint } from './core'
import type {
  AddTemplateHandler,
  ConvertDraftHandler,
  UnlinkDraftHandler,
  SetOwnerHandler,
  SetRoleHandler,
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
  PublishManyHandler,
  ResolveHandler,
  SetSizeHandler,
  StartWeekHandler,
  ReadyHandler,
  RefreshHandler,
  ResizeWindowHandler,
  SelectedHandler,
  SetGuideHandler,
  SetLabelsHandler,
  SetLangHandler,
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
  // Stickies made into a draft on the project board: its item, and the
  // template it started from.
  drafts: Record<string, DraftLink>
  repo: string
  project: string
  token: string
  login: string | null
  role: Role
  sprints: Array<Sprint>
  board: ProjectBoard | null
  mode: ReadingMode
  rowTypes: Record<string, ItemType>
  nodeTypes: Record<string, number>
  labelsOn: boolean
  guide: Guide
  readAt: number | null
  meta: (RepoMeta & { canPush: boolean }) | null
  writeAllowed: boolean
  publishing: Publishing
  // The language picked by this person ('auto' follows the system), and the
  // system's language, sent by the window.
  langSetting: LangSetting
  navigatorLanguage: string
}

// Generic starting values for a new issue; each team changes them in the
// GitHub tab, per repository.
// An empty starting status means the first status of the project board.
const DEFAULT_PUBLISHING: Publishing = { startLabel: 'needs-refinement', startStatus: '', bodyTemplate: '' }

const state: State = {
  items: [],
  palette: [],
  legend: {},
  backlog: null,
  matches: {},
  issues: null,
  links: {},
  drafts: {},
  repo: '',
  project: '',
  token: '',
  login: null,
  role: 'both',
  sprints: [],
  board: null,
  mode: 'auto',
  rowTypes: {},
  nodeTypes: {},
  labelsOn: false,
  guide: { readingConfirmed: false, hidden: false },
  readAt: null,
  meta: null,
  writeAllowed: false,
  publishing: { ...DEFAULT_PUBLISHING },
  langSetting: 'auto',
  navigatorLanguage: '',
}

// The language follows the person's setting, or the system when automatic.
async function loadLang() {
  const saved = (await figma.clientStorage.getAsync('lang')) as LangSetting | undefined
  state.langSetting = saved === 'en' || saved === 'fr' ? saved : 'auto'
  setLang(resolveLang(state.langSetting, state.navigatorLanguage))
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

const draftKey = () => `draft:${state.repo.toLowerCase()}`

// A sticky's draft: its item on the project board (and which board), and the
// template it started from.
interface DraftLink {
  item: string
  template: string
  project?: string
}

function readLinks() {
  state.links = {}
  state.drafts = {}
  if (!state.repo) return
  for (const [id, node] of stickies) {
    const value = node.getPluginData(linkKey())
    if (value !== '') state.links[id] = Number(value)
    const draft = node.getPluginData(draftKey())
    if (draft) {
      try {
        state.drafts[id] = JSON.parse(draft) as DraftLink
      } catch {
        // A damaged value is dropped; the draft stays on the board.
      }
    }
  }
}

function writeDraft(id: string, draft: DraftLink | null) {
  const node = stickies.get(id)
  if (!node || !state.repo) return
  node.setPluginData(draftKey(), draft ? JSON.stringify(draft) : '')
  if (draft) state.drafts[id] = draft
  else delete state.drafts[id]
}

// A draft converted on GitHub keeps its board item, which now holds the
// issue: the sticky is linked to it. A draft deleted from the board is
// forgotten. Only when the board was read.
// Drafts of another board are left alone. An item the read did not show (a
// board cut at 2,000 items, an archived draft) is asked for by its id, and
// forgotten only when GitHub says it is gone.
async function reconcileDrafts() {
  const board = state.board
  if (!board) return
  const prefix = `${state.repo}#`.toLowerCase()
  const seen = new Set<string>()
  for (const [id, d] of Object.entries(state.drafts)) {
    if (d.project && board.id && d.project !== board.id) continue
    // A duplicated sticky carries the same draft: the first one keeps it.
    if (seen.has(d.item)) {
      writeDraft(id, null)
      continue
    }
    seen.add(d.item)
    if (board.drafts[d.item]) continue
    let key = Object.keys(board.itemIds).find((k) => board.itemIds[k] === d.item) || null
    if (!key) {
      try {
        const found = await graphql<{ node: { content: { __typename: string; number?: number; repository?: { nameWithOwner: string } } | null } | null }>(
          'query($id: ID!) { node(id: $id) { ... on ProjectV2Item { content { __typename ... on Issue { number repository { nameWithOwner } } } } } }',
          { id: d.item },
        )
        if (found.node && found.node.content && found.node.content.__typename === 'DraftIssue') continue
        if (found.node && found.node.content && found.node.content.number && found.node.content.repository) {
          key = `${found.node.content.repository.nameWithOwner}#${found.node.content.number}`.toLowerCase()
        }
      } catch {
        // Not sure it is gone: keep the link.
        continue
      }
    }
    if (key && key.startsWith(prefix)) writeLink(id, Number(key.slice(prefix.length)))
    writeDraft(id, null)
  }
}

// Forgets the draft on every other sticky that carries the same item.
function dropCopies(item: string, keep: string) {
  for (const [id, d] of Object.entries(state.drafts)) if (id !== keep && d.item === item) writeDraft(id, null)
}

function writeLink(id: string, number: number | null) {
  const node = stickies.get(id)
  if (!node || !state.repo) return
  node.setPluginData(linkKey(), number === null ? '' : String(number))
  if (number === null) delete state.links[id]
  else state.links[id] = number
}

// Who makes which change, shared by the team in the file, per repository.
const ownersKey = () => `owners:${state.repo.toLowerCase()}`

function owners(): Record<Action, Role> {
  const saved = state.repo && figma.root.getPluginData(ownersKey())
  return { ...DEFAULT_OWNERS, ...(saved ? (JSON.parse(saved) as Partial<Record<Action, Role>>) : {}) }
}

function mustBeAllowed(action: Action) {
  if (canDo(state.role, action, owners())) return
  throw new Error(
    owners()[action] === 'pm'
      ? t('On this board, that change is for the product manager. Change your role or the split in the GitHub tab.')
      : t('On this board, that change is for the tech lead. Change your role or the split in the GitHub tab.'),
  )
}

// A starting story map on an empty page, laid out like Figma's template.
async function addTemplate() {
  const center = figma.viewport.center
  const shapes = starterLayout()
  const width = Math.max(...shapes.map((s) => s.x + s.w))
  const height = Math.max(...shapes.map((s) => s.y + s.h))
  const made: Array<SceneNode> = []
  for (const shape of shapes) {
    const x = center.x - width / 2 + shape.x
    const y = center.y - height / 2 + shape.y
    if (shape.kind === 'label') {
      const label = figma.createShapeWithText()
      label.shapeType = 'SQUARE'
      label.resize(shape.w, shape.h)
      label.fills = [{ type: 'SOLID', color: shape.fill }]
      await figma.loadFontAsync(label.text.fontName as FontName)
      label.text.characters = shape.text
      label.x = x
      label.y = y
      made.push(label)
    } else {
      const sticky = figma.createSticky()
      await figma.loadFontAsync(sticky.text.fontName as FontName)
      sticky.text.characters = shape.text
      sticky.fills = [{ type: 'SOLID', color: shape.fill }]
      sticky.x = x
      sticky.y = y
      made.push(sticky)
    }
  }
  figma.currentPage.selection = made
  figma.viewport.scrollAndZoomIntoView(made)
  readBoard()
  publish()
}

// The start of the week: a snapshot of the issues, kept in the file per
// repository so the whole team compares against the same moment.
const weekKey = () => `week:${state.repo.toLowerCase()}`

function readWeek() {
  if (!state.repo || !state.issues) return null
  const raw = figma.root.getPluginData(weekKey())
  if (!raw) return null
  const week = JSON.parse(raw) as { at: string; snapshot: Record<string, Record<string, string | null>> }
  return { at: week.at, moved: changesSince(week.snapshot, state.issues) }
}

function startWeek() {
  if (!state.repo || !state.issues) throw new Error(t('Connect a repository first.'))
  figma.root.setPluginData(weekKey(), JSON.stringify({ at: new Date().toISOString(), snapshot: snapshotOf(state.issues) }))
  publish()
  emit<StatusHandler>('STATUS', { state: 'ok', text: t('A new week starts now: changes from here on show in Differences.') })
}

// Differences the team keeps on purpose, on each sticky and per repository,
// so the whole team stops seeing them; one comes back when either side changes.
const keptKey = () => `kept:${state.repo.toLowerCase()}`

function readKept(): Record<string, Array<string>> {
  const kept: Record<string, Array<string>> = {}
  if (!state.repo) return kept
  for (const [id, node] of stickies) {
    const value = node.getPluginData(keptKey())
    if (value) kept[id] = JSON.parse(value) as Array<string>
  }
  return kept
}

// Settles one difference. Only what the person picked is changed, and the
// plugin's own copy of the issue is updated at once (GitHub's list can lag).
async function resolve(id: string, key: string, side: 'map' | 'github' | 'keep') {
  if (!state.backlog || !state.issues) return
  const drift = findDrift(state.backlog, state.issues, state.matches).drifts.find((d) => d.id === id && driftKey(d) === key)
  if (!drift) throw new Error(t('This difference is already settled.'))
  emit<StatusHandler>('STATUS', {
    state: 'loading',
    text: side === 'keep' ? t('Keeping both…') : side === 'github' ? t('Changing the sticky…') : t('Changing #{n} on GitHub…', { n: drift.number }),
  })
  const node = stickies.get(id)
  if (side === 'keep') {
    if (!node) throw new Error(t('The sticky is not on this page.'))
    const list = node.getPluginData(keptKey()) ? (JSON.parse(node.getPluginData(keptKey())) as Array<string>) : []
    node.setPluginData(keptKey(), JSON.stringify([...list, key]))
    publish()
    emit<StatusHandler>('STATUS', { state: 'ok', text: t('Kept as it is: #{n} will not show here again unless it changes.', { n: drift.number }) })
    return
  }
  mustBeAllowed(drift.kind === 'parent' ? 'parent' : drift.kind === 'milestone' ? 'milestone' : 'title')
  if (side === 'github') {
    if (drift.kind !== 'title' || !node) throw new Error(t('Only a title can be taken from GitHub onto the map.'))
    const issue = state.issues.find((i) => i.number === drift.number)
    if (!issue) return
    await figma.loadFontAsync(node.text.fontName as FontName)
    node.text.characters = issue.title
    readBoard()
    publish()
    emit<StatusHandler>('STATUS', { state: 'ok', text: t('The sticky now reads "{title}".', { title: issue.title }) })
    return
  }
  if (!state.writeAllowed) throw new Error(t('Changes to {repo} are not allowed. Turn them on in the GitHub tab.', { repo: state.repo }))
  const issue = state.issues.find((i) => i.number === drift.number)
  if (!issue) return
  const patch = async (body: Record<string, unknown>) => {
    const res = await fetch(`https://api.github.com/repos/${state.repo}/issues/${drift.number}`, {
      method: 'PATCH',
      headers: { ...githubHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(t('GitHub refused the change ({status}).', { status: res.status }))
    return (await res.json()) as RawIssue & { id: number }
  }
  let text = ''
  if (drift.kind === 'title') {
    await patch({ title: drift.target })
    issue.title = String(drift.target)
    text = t('#{n} is now "{title}".', { n: drift.number, title: issue.title })
  } else if (drift.kind === 'milestone') {
    const release = drift.target ? String(drift.target) : null
    const milestone = release ? (state.meta ? state.meta.milestones.find((m) => sameRelease(release, m.title)) : null) : null
    if (release && !milestone) throw new Error(t('No milestone on GitHub matches "{release}". Create it on GitHub first.', { release }))
    await patch({ milestone: milestone ? milestone.number : null })
    issue.milestone = milestone ? milestone.title : null
    text = milestone ? t('#{n} is now in {milestone}.', { n: drift.number, milestone: milestone.title }) : t('#{n} has no milestone now.', { n: drift.number })
  } else if (drift.kind === 'parent') {
    const res = await fetch(`https://api.github.com/repos/${state.repo}/issues/${drift.number}`, { headers: githubHeaders() })
    if (!res.ok) throw new Error(t('GitHub answered {status} for #{n}.', { status: res.status, n: drift.number }))
    const raw = (await res.json()) as { id: number }
    const moved = await fetch(`https://api.github.com/repos/${state.repo}/issues/${drift.target}/sub_issues`, {
      method: 'POST',
      headers: { ...githubHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ sub_issue_id: raw.id, replace_parent: true }),
    })
    if (!moved.ok) throw new Error(t('GitHub refused to move #{n} under #{parent} ({status}).', { n: drift.number, parent: String(drift.target), status: moved.status }))
    issue.parent = Number(drift.target)
    text = t('#{n} is now under #{parent}.', { n: drift.number, parent: String(drift.target) })
  } else {
    throw new Error(t('This difference is settled on GitHub by hand: open the issue.'))
  }
  publish()
  emit<StatusHandler>('STATUS', { state: 'ok', text })
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
  state.role = (await figma.clientStorage.getAsync('role')) || 'both'
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
  // A sticky matched by an identical title is linked for good, so a later
  // rename on either side shows as a difference instead of losing the link.
  let saved = false
  for (const [id, m] of Object.entries(state.matches)) {
    if (m.status === 'exists' && m.number && !(id in state.links)) {
      writeLink(id, m.number)
      saved = true
    }
  }
  if (saved && state.issues) state.matches = matchIssues(state.backlog, state.issues, state.links)
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
    drift: state.issues ? findDrift(state.backlog, state.issues, state.matches, readKept()) : null,
    nodeTypes: state.nodeTypes,
    markdown: toMarkdown(state.backlog, state.matches),
    labelsOn: state.labelsOn,
    guide: state.guide,
    week: readWeek(),
    readAt: state.readAt,
    drafts: Object.fromEntries(
      Object.entries(state.drafts).map(([id, d]) => {
        const onBoard = state.board ? state.board.drafts[d.item] : null
        return [id, { title: onBoard ? onBoard.title : '', status: onBoard && onBoard.status ? onBoard.status : null }]
      }),
    ),
    settings: {
      repo: state.repo,
      project: state.project,
      mode: state.mode,
      hasToken: Boolean(state.token),
      login: state.login,
      issuesLoaded: state.issues ? state.issues.length : null,
      meta: state.meta,
      writeAllowed: state.writeAllowed,
      role: state.role,
      owners: owners(),
      sizeOptions: state.board && state.board.sizeField ? state.board.sizeField.options.map((o) => o.name) : null,
      statusOptions: state.board ? state.board.statusOptions : null,
      publishing: state.publishing,
      // The template a new issue starts from: the team's own text when it
      // wrote one, else the repository's story template, else the plugin's.
      defaultTemplate: defaultTemplate(),
      lang: getLang(),
      langSetting: state.langSetting,
    },
  })
  void syncLabels()
}

const defaultTemplate = () => (state.publishing.bodyTemplate || !state.meta ? '' : pickTemplate(state.meta.templates) || '')
const templateOf = (file: string): IssueTemplate | null => (file && state.meta && (state.meta.templates || []).find((x) => x.file === file)) || null

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

const toIssue = (i: RawIssue): Issue => ({
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

async function fetchIssues(): Promise<Array<Issue>> {
  if (!/^[\w.-]+\/[\w.-]+$/.test(state.repo)) throw new Error(t('Enter the repository as owner/name.'))
  const all: Array<Issue> = []
  for (let page = 1; page <= 10; page += 1) {
    const res = await fetch(`https://api.github.com/repos/${state.repo}/issues?state=all&per_page=100&page=${page}`, { headers: githubHeaders() })
    if (!res.ok) {
      if (res.status === 404) throw new Error(t('Repository {repo} not found, or private without a token.', { repo: state.repo }))
      if (res.status === 401) throw new Error(t('GitHub refused the token.'))
      if (res.status === 403) throw new Error(t('GitHub rate limit reached. Add a token or retry later.'))
      throw new Error(t('GitHub answered {status}.', { status: res.status }))
    }
    const batch = (await res.json()) as Array<RawIssue>
    for (const i of batch) if (!i.pull_request) all.push(toIssue(i))
    if (batch.length < 100) break
  }
  return all
}

// Sprints live in a GitHub Projects board, read through GraphQL, which
// always needs a token (read access to projects).
async function fetchProject(): Promise<ProjectBoard> {
  const target = parseProjectUrl(state.project)
  if (!target) throw new Error(t('Paste the project board address, like https://github.com/orgs/acme/projects/12.'))
  if (!state.token) throw new Error(t('Reading sprints needs a token that can read projects (classic token: read:project).'))
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
    if (!res.ok || !project) throw new Error(body.errors ? t('Could not read the project board: {error}', { error: body.errors[0].message }) : t('Could not read the project board.'))
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
  const [repo, milestones, types, files] = await Promise.all([
    get(`repos/${state.repo}`),
    get(`repos/${state.repo}/milestones?state=all&per_page=100`),
    get(`orgs/${owner}/issue-types`),
    get(`repos/${state.repo}/contents/.github/ISSUE_TEMPLATE`),
  ])
  // The repository's issue templates, forms and Markdown, read as raw text.
  const templates: Array<IssueTemplate> = []
  for (const f of (Array.isArray(files) ? files : []) as Array<{ name: string; type: string }>) {
    if (f.type !== 'file' || !/\.(ya?ml|md)$/i.test(f.name)) continue
    const res = await fetch(`https://api.github.com/repos/${state.repo}/contents/.github/ISSUE_TEMPLATE/${encodeURIComponent(f.name)}`, {
      headers: { ...githubHeaders(), Accept: 'application/vnd.github.raw' },
    })
    if (!res.ok) continue
    const tpl = parseIssueTemplate(f.name, await res.text())
    if (tpl) templates.push(tpl)
  }
  return {
    canPush: Boolean(repo && repo.permissions && repo.permissions.push),
    repoId: repo ? (repo.node_id as string) : null,
    templates,
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
  if (!res.ok || body.errors || !body.data) throw new Error(body.errors ? body.errors[0].message : t('GitHub answered {status}.', { status: res.status }))
  return body.data
}

// Adds an issue to the project board and sets its starting status, when the
// board has that status; an empty status means the board's first one.
// Returns what was done, for the message.
async function addToProject(nodeId: string, status: string | null): Promise<string> {
  const project = await projectWithStatus()
  if (!project) return ''
  const added = await graphql<{ addProjectV2ItemById: { item: { id: string } } }>(
    'mutation($project: ID!, $content: ID!) { addProjectV2ItemById(input: { projectId: $project, contentId: $content }) { item { id } } }',
    { project: project.id, content: nodeId },
  )
  return (await setStatus(project, added.addProjectV2ItemById.item.id, status)).note
}

// The project board's id and its Status field.
async function projectWithStatus(): Promise<{ id: string; field: { id: string; options: Array<{ id: string; name: string }> } | null } | null> {
  const target = parseProjectUrl(state.project)
  if (!target) return null
  const data = await graphql<{ owner: { projectV2: { id: string; field: { id: string; options: Array<{ id: string; name: string }> } | null } } }>(
    `query($owner: String!, $number: Int!) { owner: ${target.kind}(login: $owner) { projectV2(number: $number) { id field(name: "Status") { ... on ProjectV2SingleSelectField { id options { id name } } } } } }`,
    { owner: target.owner, number: target.number },
  )
  return data.owner.projectV2
}

// Puts a board item in a status; an empty status means the board's first.
async function setStatus(
  project: { id: string; field: { id: string; options: Array<{ id: string; name: string }> } | null },
  itemId: string,
  status: string | null,
): Promise<{ note: string; status: string | null }> {
  const option = project.field && (status ? project.field.options.find((o) => o.name.toLowerCase() === status.toLowerCase()) : project.field.options[0])
  if (!project.field || !option) {
    return {
      status: null,
      note: status ? t('Added to the board, without status: it has no "{status}" status.', { status }) : t('Added to the board, without status: it has no Status field.'),
    }
  }
  await graphql(
    'mutation($project: ID!, $item: ID!, $field: ID!, $option: String!) { updateProjectV2ItemFieldValue(input: { projectId: $project, itemId: $item, fieldId: $field, value: { singleSelectOptionId: $option } }) { projectV2Item { id } } }',
    { project: project.id, item: itemId, field: project.field.id, option: option.id },
  )
  return { status: option.name, note: t('Added to the board in {status}.', { status: option.name }) }
}

// Sets the size of an issue on the project board, the product manager's
// field. The issue is added to the board first if it is not on it yet.
async function setSize(number: number, size: string | null) {
  mustBeAllowed('size')
  if (!state.writeAllowed) throw new Error(t('Changes to {repo} are not allowed. Turn them on in the GitHub tab.', { repo: state.repo }))
  const board = state.board
  if (!board || !board.id || !board.sizeField) throw new Error(t('The project board has no size field.'))
  const key = `${state.repo}#${number}`.toLowerCase()
  let item = board.itemIds[key]
  if (!item) {
    const res = await fetch(`https://api.github.com/repos/${state.repo}/issues/${number}`, { headers: githubHeaders() })
    if (!res.ok) throw new Error(t('GitHub answered {status} for #{n}.', { status: res.status, n: number }))
    const issue = (await res.json()) as { node_id: string }
    const added = await graphql<{ addProjectV2ItemById: { item: { id: string } } }>(
      'mutation($project: ID!, $content: ID!) { addProjectV2ItemById(input: { projectId: $project, contentId: $content }) { item { id } } }',
      { project: board.id, content: issue.node_id },
    )
    item = added.addProjectV2ItemById.item.id
    board.itemIds[key] = item
  }
  const field = board.sizeField
  if (size === null) {
    await graphql('mutation($project: ID!, $item: ID!, $field: ID!) { clearProjectV2ItemFieldValue(input: { projectId: $project, itemId: $item, fieldId: $field }) { projectV2Item { id } } }', {
      project: board.id,
      item,
      field: field.id,
    })
  } else {
    const option = field.options.find((o) => o.name === size)
    if (!option) throw new Error(t('The board has no size "{size}".', { size }))
    await graphql(
      'mutation($project: ID!, $item: ID!, $field: ID!, $option: String!) { updateProjectV2ItemFieldValue(input: { projectId: $project, itemId: $item, fieldId: $field, value: { singleSelectOptionId: $option } }) { projectV2Item { id } } }',
      { project: board.id, item, field: field.id, option: option.id },
    )
  }
  const issue = state.issues && state.issues.find((i) => i.number === number)
  if (issue) issue.size = size || undefined
  publish()
  emit<StatusHandler>('STATUS', { state: 'ok', text: size ? t('#{n} is now size {size}.', { n: number, size }) : t('#{n} has no size now.', { n: number }) })
}

// Publishes one sticky as an issue: the issue, its place under its parent,
// the project board, then the link on the sticky. Only when the team allowed
// writing to this repository.
async function createIssue(id: string, title: string, text: string, templateFile: string): Promise<{ issue: Issue; note: string; problems: Array<string> }> {
  mustBeAllowed('create')
  if (!state.writeAllowed) throw new Error(t('Changes to {repo} are not allowed. Turn them on in the GitHub tab.', { repo: state.repo }))
  if (!state.token) throw new Error(t('Publishing needs a token that can write issues.'))
  if (!state.backlog || !state.meta) throw new Error(t('Compare with GitHub first.'))
  if (state.drafts[id]) throw new Error(t('This sticky already has a draft on the board: convert it instead.'))
  const draft = draftIssue(id, state.backlog, state.matches, state.meta, state.publishing, templateOf(templateFile))
  if (!draft) throw new Error(t('This sticky is already an issue.'))
  const name = title.trim() || draft.title
  emit<StatusHandler>('STATUS', { state: 'loading', text: t('Creating "{title}" in {repo}…', { title: name, repo: state.repo }) })
  const res = await fetch(`https://api.github.com/repos/${state.repo}/issues`, {
    method: 'POST',
    headers: { ...githubHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: name,
      body: text.trim() || draft.body,
      labels: draft.labels,
      ...(draft.milestone ? { milestone: draft.milestone.number } : {}),
      ...(draft.type ? { type: draft.type } : {}),
    }),
  })
  if (!res.ok) {
    const detail = ((await res.json().catch(() => ({}))) as { message?: string }).message
    throw new Error(detail ? t('GitHub refused the issue ({status}: {detail}).', { status: res.status, detail }) : t('GitHub refused the issue ({status}).', { status: res.status }))
  }
  const made = (await res.json()) as RawIssue & { id: number; node_id: string }
  writeLink(id, made.number)
  let note = t('#{n} created.', { n: made.number })
  const problems: Array<string> = []
  if (draft.parent && draft.parent.number) note += await makeSubIssue(draft.parent.number, made.id, problems)
  if (state.project) {
    try {
      const added = await addToProject(made.node_id, draft.status)
      if (added) note += ` ${added}`
    } catch (err) {
      problems.push(t('not added to the board ({error})', { error: err instanceof Error ? err.message : String(err) }))
    }
  }
  // The plugin knows the new issue at once, so the next sticky of a batch
  // finds it as its parent and the card shows it instead of the form.
  const issue: Issue = { ...toIssue(made), parent: draft.parent ? draft.parent.number : null, status: draft.status || undefined }
  if (state.issues) state.issues.push(issue)
  publish()
  return { issue, note, problems }
}

// Puts a new issue under its parent; returns the note, or adds the problem.
async function makeSubIssue(parent: number, issueId: number, problems: Array<string>): Promise<string> {
  const sub = await fetch(`https://api.github.com/repos/${state.repo}/issues/${parent}/sub_issues`, {
    method: 'POST',
    headers: { ...githubHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ sub_issue_id: issueId }),
  })
  if (sub.ok) return ` ${t('Sub-issue of #{n}.', { n: parent })}`
  problems.push(t('not made a sub-issue of #{n} (GitHub answered {status})', { n: parent, status: sub.status }))
  return ''
}

// Makes a sticky a draft issue on the project board: a title and a text,
// nothing in the repository yet. The product manager refines it there, then
// converts it into an issue.
async function createDraft(id: string, title: string, text: string, templateFile: string) {
  mustBeAllowed('create')
  if (!state.writeAllowed) throw new Error(t('Changes to {repo} are not allowed. Turn them on in the GitHub tab.', { repo: state.repo }))
  if (!state.token) throw new Error(t('Publishing needs a token that can write issues.'))
  if (!state.backlog || !state.meta) throw new Error(t('Compare with GitHub first.'))
  const board = state.board
  if (!board || !board.id) throw new Error(t('A draft lives on a project board: pick one in the GitHub tab.'))
  if (state.drafts[id]) throw new Error(t('This sticky already has a draft on the board: convert it instead.'))
  const draft = draftIssue(id, state.backlog, state.matches, state.meta, state.publishing, templateOf(templateFile))
  if (!draft) throw new Error(t('This sticky is already an issue.'))
  const name = title.trim() || draft.title
  emit<StatusHandler>('STATUS', { state: 'loading', text: t('Adding the draft "{title}" to the board…', { title: name }) })
  const made = await graphql<{ addProjectV2DraftIssue: { projectItem: { id: string } } }>(
    'mutation($project: ID!, $title: String!, $body: String) { addProjectV2DraftIssue(input: { projectId: $project, title: $title, body: $body }) { projectItem { id } } }',
    { project: board.id, title: name, body: text.trim() || draft.body },
  )
  const item = made.addProjectV2DraftIssue.projectItem.id
  writeDraft(id, { item, template: templateFile, project: board.id })
  board.drafts[item] = { title: name }
  let note = t('Draft "{title}" added to the board.', { title: name })
  let warn = false
  try {
    const project = await projectWithStatus()
    if (project) {
      const set = await setStatus(project, item, draft.status)
      if (set.status) board.drafts[item].status = set.status
      else {
        warn = true
        note += ` ${set.note}`
      }
    }
  } catch (err) {
    warn = true
    note += ` ${t('Its status was not set ({error}).', { error: err instanceof Error ? err.message : String(err) })}`
  }
  publish()
  emit<StatusHandler>('STATUS', { state: warn ? 'warn' : 'ok', text: note })
}

// Turns a sticky's draft into an issue of the repository, then gives it
// what a draft cannot hold: labels, milestone, type, and its parent.
async function convertDraft(id: string) {
  mustBeAllowed('create')
  if (!state.writeAllowed) throw new Error(t('Changes to {repo} are not allowed. Turn them on in the GitHub tab.', { repo: state.repo }))
  const linked = state.drafts[id]
  if (!linked) throw new Error(t('This sticky has no draft on the board.'))
  if (!state.backlog || !state.meta || !state.meta.repoId) throw new Error(t('Compare with GitHub first.'))
  const draft = draftIssue(id, state.backlog, state.matches, state.meta, state.publishing, templateOf(linked.template))
  emit<StatusHandler>('STATUS', { state: 'loading', text: t('Converting the draft into an issue of {repo}…', { repo: state.repo }) })
  const converted = await graphql<{ convertProjectV2DraftIssueItemToIssue: { item: { content: { number?: number } | null } } }>(
    'mutation($item: ID!, $repo: ID!) { convertProjectV2DraftIssueItemToIssue(input: { itemId: $item, repositoryId: $repo }) { item { content { ... on Issue { number } } } } }',
    { item: linked.item, repo: state.meta.repoId },
  )
  const number = converted.convertProjectV2DraftIssueItemToIssue.item.content && converted.convertProjectV2DraftIssueItemToIssue.item.content.number
  if (!number) throw new Error(t('GitHub did not say which issue the draft became.'))
  const status = state.board && state.board.drafts[linked.item] ? state.board.drafts[linked.item].status : undefined
  if (state.board) {
    delete state.board.drafts[linked.item]
    state.board.itemIds[`${state.repo}#${number}`.toLowerCase()] = linked.item
  }
  writeDraft(id, null)
  dropCopies(linked.item, id)
  writeLink(id, number)
  let note = t('#{n} created from the draft.', { n: number })
  const problems: Array<string> = []
  const res = await fetch(`https://api.github.com/repos/${state.repo}/issues/${number}`, {
    method: 'PATCH',
    headers: { ...githubHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      labels: draft ? draft.labels : [],
      ...(draft && draft.milestone ? { milestone: draft.milestone.number } : {}),
      ...(draft && draft.type ? { type: draft.type } : {}),
    }),
  })
  let made: (RawIssue & { id: number }) | null = null
  if (res.ok) made = (await res.json()) as RawIssue & { id: number }
  else {
    problems.push(t('its labels and milestone were not set (GitHub answered {status})', { status: res.status }))
    // The issue exists all the same: read it, to put it under its parent.
    const got = await fetch(`https://api.github.com/repos/${state.repo}/issues/${number}`, { headers: githubHeaders() })
    if (got.ok) made = (await got.json()) as RawIssue & { id: number }
  }
  if (draft && draft.parent && draft.parent.number) {
    if (made) note += await makeSubIssue(draft.parent.number, made.id, problems)
    else problems.push(t('not made a sub-issue of #{n} (GitHub answered {status})', { n: draft.parent.number, status: res.status }))
  }
  const issue: Issue | null = made ? { ...toIssue(made), parent: draft && draft.parent ? draft.parent.number : null, status } : null
  if (issue && state.issues) state.issues.push(issue)
  publish()
  await refreshAfter(issue ? [issue] : [])
  emit<StatusHandler>('STATUS', { state: problems.length ? 'warn' : 'ok', text: problems.length ? t('{note} But {problems}.', { note, problems: problems.join(', ') }) : note })
}

// Reads GitHub again after creating issues. GitHub's issue list can lag by
// a minute, so the issues just created are kept if the list misses them.
async function refreshAfter(created: Array<Issue>) {
  await compare()
  const missing = created.filter((c) => state.issues && !state.issues.some((i) => i.number === c.number))
  if (missing.length && state.issues) {
    state.issues.push(...missing)
    publish()
  }
}

async function publishSticky(id: string, title: string, text: string, templateFile: string) {
  const { issue, note, problems } = await createIssue(id, title, text, templateFile)
  await refreshAfter([issue])
  emit<StatusHandler>('STATUS', { state: problems.length ? 'warn' : 'ok', text: problems.length ? t('{note} But {problems}.', { note, problems: problems.join(', ') }) : note })
}

// Publishes a batch the team reviewed, parents first, one at a time; stops
// at the first issue GitHub refuses and says what was created.
async function publishMany(ids: Array<string>) {
  if (!state.backlog) return
  const order = publishOrder(state.backlog, ids)
  const created: Array<Issue> = []
  const problems: Array<string> = []
  try {
    for (const [n, id] of order.entries()) {
      emit<StatusHandler>('STATUS', { state: 'loading', text: t('Creating {n} of {total}…', { n: n + 1, total: order.length }) })
      const result = await createIssue(id, '', '', defaultTemplate())
      created.push(result.issue)
      problems.push(...result.problems.map((p) => `#${result.issue.number} ${p}`))
    }
  } catch (err) {
    await refreshAfter(created)
    const error = err instanceof Error ? err.message : String(err)
    const list = created.map((i) => `#${i.number}`).join(', ')
    emit<StatusHandler>('STATUS', {
      state: 'error',
      text: created.length
        ? plural(created.length, '{n} issue created ({list}), then stopped: {error}', '{n} issues created ({list}), then stopped: {error}', { list, error })
        : t('Stopped: {error}', { error }),
    })
    return
  }
  await refreshAfter(created)
  const list = created.map((i) => `#${i.number}`).join(', ')
  const done = plural(created.length, '{n} issue created: {list}.', '{n} issues created: {list}.', { list })
  emit<StatusHandler>('STATUS', {
    state: problems.length ? 'warn' : 'ok',
    text: problems.length ? t('{note} But {problems}.', { note: done, problems: problems.join('; ') }) : done,
  })
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
  if (!code.device_code) throw new Error(t('GitHub did not start the sign-in ({error}).', { error: String(code.error || t('no answer')) }))
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
    if (error === 'access_denied') return sendAuth({ state: 'error', error: t('Sign-in was cancelled on GitHub.') })
    return sendAuth({ state: 'error', error: t('GitHub stopped the sign-in ({error}).', { error: error || t('no answer') }) })
  }
  if (run === signInRun) sendAuth({ state: 'error', error: t('The code expired. Start again.') })
}

// Keeps a token, from the sign-in or pasted, and finds whose it is.
// A token GitHub refuses is never saved.
async function useToken(token: string) {
  const res = await fetch('https://api.github.com/user', { headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(t('GitHub refused this token.'))
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
  emit<StatusHandler>('STATUS', { state: 'loading', text: t('Reading issues of {repo}…', { repo: state.repo }) })
  state.issues = await fetchIssues()
  state.meta = await fetchMeta()
  // Listing the owner's issue types needs read:org; the types the issues
  // already use are known without it.
  for (const i of state.issues) if (i.type && !state.meta.types.includes(i.type)) state.meta.types.push(i.type)
  let note = plural(state.issues.length, '{n} issue read from {repo}.', '{n} issues read from {repo}.', { repo: state.repo })
  let warn = false
  state.sprints = []
  state.board = null
  if (state.project) {
    try {
      const board = await fetchProject()
      state.issues = withProject(state.issues, board)
      state.sprints = board.sprints
      state.board = board
      await reconcileDrafts()
      note += ` ${t('Sprints read from "{board}" ({n}).', { board: board.title, n: board.sprints.length })}`
    } catch (err) {
      warn = true
      note += ` ${t('Sprints not read: {error}', { error: err instanceof Error ? err.message : String(err) })}`
    }
  }
  state.readAt = Date.now()
  publish()
  emit<StatusHandler>('STATUS', { state: warn ? 'warn' : 'ok', text: note })
}

// Commands from the panel ----------------------------------------------------

const fail =(err: unknown) => emit<StatusHandler>('STATUS', { state: 'error', text: err instanceof Error ? err.message : String(err) })

export default function () {
  on<ReadyHandler>('READY', (navigatorLanguage) => {
    state.navigatorLanguage = navigatorLanguage || ''
    void (async () => {
      // The language first, so every message below comes out in it.
      await loadLang()
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
    if (state.repo) void compare().catch(fail)
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
      emit<WhyResultHandler>('WHY_RESULT', key, lines, res.ok ? null : t('GitHub answered {status}.', { status: res.status }))
    })().catch(fail)
  })

  on<OpenHandler>('OPEN', (url) => {
    if (/^https:\/\/github\.com\//.test(url)) figma.openExternal(url)
  })

  on<LinkHandler>('LINK', (id, number) => {
    writeLink(id, number)
    if (number) writeDraft(id, null)
    publish()
  })

  on<ConvertDraftHandler>('CONVERT_DRAFT', (id) => {
    void convertDraft(id).catch(fail)
  })

  // Forgets the link to a draft; the draft stays on the board.
  on<UnlinkDraftHandler>('UNLINK_DRAFT', (id) => {
    writeDraft(id, null)
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
      emit<StatusHandler>('STATUS', { state: 'ok', text: t('Signed out. The token is forgotten on this computer.') })
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

  on<SetLangHandler>('SET_LANG', (setting) => {
    void (async () => {
      await figma.clientStorage.setAsync('lang', setting)
      await loadLang()
      publish()
    })().catch(fail)
  })

  on<SetRoleHandler>('SET_ROLE', (role) => {
    state.role = role
    void figma.clientStorage.setAsync('role', role).then(publish).catch(fail)
  })

  on<SetOwnerHandler>('SET_OWNER', (action, role) => {
    if (!state.repo) return
    figma.root.setPluginData(ownersKey(), JSON.stringify({ ...owners(), [action]: role }))
    publish()
  })

  on<AddTemplateHandler>('ADD_TEMPLATE', () => {
    void addTemplate().catch(fail)
  })

  on<StartWeekHandler>('START_WEEK', () => {
    try {
      startWeek()
    } catch (err) {
      fail(err)
    }
  })

  on<ResolveHandler>('RESOLVE', (id, key, side) => {
    void resolve(id, key, side).catch(fail)
  })

  on<SetSizeHandler>('SET_SIZE', (number, size) => {
    void setSize(number, size).catch(fail)
  })

  on<PublishManyHandler>('PUBLISH_MANY', (ids) => {
    void publishMany(ids).catch(fail)
  })

  on<PublishHandler>('PUBLISH', (id, title, body, templateFile, asDraft) => {
    void (asDraft ? createDraft(id, title, body, templateFile) : publishSticky(id, title, body, templateFile)).catch(fail)
  })

  on<ResizeWindowHandler>('RESIZE_WINDOW', ({ width, height }) => figma.ui.resize(width, height))

  figma.on('selectionchange', onSelectionChange)
  figma.currentPage.on('nodechange', onPageChange)

  showUI({ width: 420, height: 680, title: 'Storymap to GitHub' })
}
