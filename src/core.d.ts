// Types for core.js, the board reading logic shared by the plugin and the tests.

export type ItemType = 'epic' | 'feature' | 'step' | 'task' | 'note' | 'ignore'
export type ReadingMode = 'auto' | 'rows' | 'colours'

export interface RGB {
  r: number
  g: number
  b: number
}

// What the plugin reads from one node of the board.
export interface BoardItem {
  id: string
  type: string
  text?: string
  name?: string
  fill?: RGB | null
  x: number
  y: number
  w: number
  h: number
  inLegend?: boolean
  from?: string | null
  to?: string | null
}

export interface PaletteEntry {
  hex: string
  hue: string
  count: number
  samples: Array<string>
}

export interface MapNode {
  id: string
  title: string
  x: number
  y: number
  w: number
  h: number
  hex: string | null
}

export interface Task extends MapNode {
  release: string | null
  subtasks: Array<Task>
}

export interface Feature extends MapNode {
  steps: Array<MapNode>
  tasks: Array<Task>
}

export interface Epic extends MapNode {
  features: Array<Feature>
  tasks: Array<Task>
}

export interface Orphan extends MapNode {
  kind: string
}

export interface RowInfo {
  name: string
  kind: string
  type: ItemType
  count: number
}

export interface Backlog {
  mode: 'rows' | 'colours'
  rows: Array<RowInfo>
  epics: Array<Epic>
  looseFeatures: Array<Feature>
  notes: Array<MapNode>
  orphans: Array<Orphan>
  milestones: Array<string>
  stats: {
    epics: number
    features: number
    steps: number
    tasks: number
    notes: number
    ignored: number
    withoutMilestone: number
    swimlaneLines: number
  }
  unmapped: Array<string>
}

export interface Sprint {
  title: string
  start: string
  end: string
}

export interface Issue {
  number: number
  title: string
  html_url?: string
  state?: string
  state_reason?: string | null
  type?: string | null
  milestone?: string | null
  milestoneDue?: string | null
  parent?: number | null
  assignees?: Array<string>
  labels?: Array<string>
  sprint?: Sprint
  status?: string
  size?: string
}

export interface Match {
  status: 'linked' | 'exists' | 'maybe' | 'new'
  number?: number
  title?: string
  url?: string
  confirmed?: boolean
}

export type Matches = Record<string, Match>

export interface Drift {
  id: string
  title: string
  kind: 'dropped' | 'schedule' | 'milestone' | 'parent' | 'title'
  number: number
  url?: string
  board: string
  github: string
  // What the map wants: the sticky's title, its release, or its parent's number.
  target?: string | number | null
  // What identifies the difference, made from the English texts (see driftKey).
  key?: string
}

export interface DriftReport {
  drifts: Array<Drift>
  onlyOnGitHub: Array<{ number: number; title: string; url?: string; milestone?: string | null }>
  onlyOnBoard: Array<{ id: string; title: string; kind: string }>
  toConfirm: Array<{ id: string; title: string; kind: string; number: number }>
}

export interface SelectField {
  id: string
  name: string
  options: Array<{ id: string; name: string }>
}

export interface ProjectBoard {
  id: string | null
  title: string
  sprints: Array<Sprint>
  items: Record<string, { sprint?: Sprint; status?: string; size?: string }>
  // The field that holds sizes, when the board has one, and each card's id.
  sizeField: SelectField | null
  // The options of the Status field, in the board's order.
  statusOptions: Array<string>
  itemIds: Record<string, string>
  // Draft issues on the board, by item id.
  drafts: Record<string, { title: string; sprint?: Sprint; status?: string; size?: string }>
}

export interface Suggestion {
  number: number
  title: string
  score: number
  shared: Array<string>
}

export interface ReadingOptions {
  mode?: ReadingMode
  rowTypes?: Record<string, ItemType>
}

export interface RepoMeta {
  types: Array<string>
  milestones: Array<{ title: string; number: number }>
  // The repository's issue templates, and its node id (to convert drafts).
  templates?: Array<IssueTemplate>
  repoId?: string | null
}

// An issue template of the repository, its text ready for fillTemplate.
export interface IssueTemplate {
  file: string
  name: string
  about: string
  title: string
  labels: Array<string>
  body: string
}

export declare function parseIssueTemplate(file: string, text: string): IssueTemplate | null
export declare function pickTemplate(templates: Array<IssueTemplate> | undefined): string | null
export declare function fillTemplate(template: string, values: { title?: string; parent?: string; release?: string; steps?: string }): string

export interface Publishing {
  startLabel: string
  startStatus: string
  // The text a new issue starts with; empty means the default user story.
  bodyTemplate?: string
}

// The text a new issue starts with by default, in the language shown.
export declare function defaultBody(): string

export interface IssueDraft {
  id: string
  kind: 'epic' | 'feature' | 'task'
  title: string
  body: string
  type: string | null
  labels: Array<string>
  parent: { id: string; title: string; number: number | null } | null
  milestone: { title: string; number: number } | null
  status: string | null
  warnings: Array<string>
}

export declare function draftIssue(id: string, backlog: Backlog, matches: Matches, repo: RepoMeta, publishing: Publishing, template?: IssueTemplate | null): IssueDraft | null
export declare const TYPES: Array<ItemType>
export declare const LEGEND_PATTERN: RegExp
export declare function hexOf(c: RGB): string
export declare function hueName(c: RGB): string
export declare function buildPalette(items: Array<BoardItem>): Array<PaletteEntry>
export declare function defaultLegend(palette: Array<PaletteEntry>): Record<string, ItemType>
export declare function isReleaseLabel(item: BoardItem): boolean
export declare function buildBacklog(items: Array<BoardItem>, legend: Record<string, ItemType>, options?: ReadingOptions): Backlog
export declare function normalize(s: string): string
export declare function similarity(a: string, b: string, loose?: boolean): number
export declare function matchIssues(backlog: Backlog, issues: Array<Issue>, links?: Record<string, number>): Matches
export declare function allItems(backlog: Backlog): Array<{ item: MapNode & Partial<Task>; kind: 'epic' | 'feature' | 'task' }>
export declare function sameRelease(a: string | null | undefined, b: string | null | undefined): boolean
export type Snapshot = Record<string, Record<string, string | null>>
export interface Moved {
  number: number
  title: string
  kind: 'new' | 'closed' | 'reopened' | 'changed'
  changes: Array<{ field: string; from: string; to: string }>
}
export declare function snapshotOf(issues: Array<Issue>): Snapshot
export declare function changesSince(snapshot: Snapshot, issues: Array<Issue>): Array<Moved>
export type Role = 'pm' | 'techlead' | 'both'
export type Action = 'create' | 'size' | 'title' | 'milestone' | 'parent'
export declare const ACTIONS: Record<Action, string>
export declare const DEFAULT_OWNERS: Record<Action, Role>
export declare function canDo(role: Role | null, action: string, owners?: Partial<Record<Action, Role>>): boolean
export interface StarterShape {
  kind: 'label' | 'sticky'
  text: string
  x: number
  y: number
  w: number
  h: number
  fill: RGB
}
export declare function starterLayout(): Array<StarterShape>
export declare function publishOrder(backlog: Backlog, ids: Array<string>): Array<string>
export declare function driftKey(drift: Drift): string
export declare function findDrift(backlog: Backlog, issues: Array<Issue>, matches: Matches, kept?: Record<string, Array<string>>): DriftReport
export declare function explainEvents(events: Array<unknown>, kind: string): Array<string>
export declare function parseProjectUrl(url: string): { kind: 'organization' | 'user'; owner: string; number: number } | null
export declare function projectQuery(kind: 'organization' | 'user'): string
export declare function readProject(pages: Array<unknown>): ProjectBoard
export declare function toMarkdown(backlog: Backlog, matches?: Matches): string
export declare function suggestIssues(title: string, kind: string, issues: Array<Issue>, count?: number): Array<Suggestion>
export declare function labelText(issue: Issue): string

export type StatusTone = 'done' | 'active' | 'waiting' | 'closed'
export declare function statusTone(status: string | null | undefined, state?: string): StatusTone
export declare function matchesStatus(issue: { state?: string; status: string | null } | null, filter: string): boolean
