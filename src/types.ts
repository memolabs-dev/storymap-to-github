// Messages between the plugin code (main.ts) and its window (ui.tsx), in the
// typed style of Create Figma Plugin's `emit` and `on`.
import { EventHandler } from '@create-figma-plugin/utilities'

import type { Action, Backlog, DriftReport, ItemType, Matches, Moved, Role, PaletteEntry, Publishing, ReadingMode, RepoMeta, Sprint } from './core'

export interface IssueSummary {
  number: number
  title: string
  url?: string
  state?: string
  sprint: string | null
  status: string | null
  size: string | null
  assignees: Array<string>
}

export interface BoardPayload {
  page: string
  palette: Array<PaletteEntry>
  legend: Record<string, ItemType>
  backlog: Backlog
  matches: Matches
  issues: Array<IssueSummary>
  sprints: Array<Sprint>
  drift: DriftReport | null
  nodeTypes: Record<string, number>
  markdown: string
  labelsOn: boolean
  guide: Guide
  // What moved since the team marked the start of the week, or null when
  // no week was started for this repository.
  week: { at: string; moved: Array<Moved> } | null
  // When GitHub was last read, in milliseconds since 1970; null if never.
  readAt: number | null
  settings: {
    repo: string
    project: string
    mode: ReadingMode
    hasToken: boolean
    // The GitHub account the plugin is signed in with, when signed in.
    login: string | null
    issuesLoaded: number | null
    // What the repository offers to new issues, read with its issues.
    meta: (RepoMeta & { canPush: boolean }) | null
    // Whether the team allowed the plugin to write to this repository.
    writeAllowed: boolean
    publishing: Publishing
    // The sizes the project board offers (its Size field), or null.
    sizeOptions: Array<string> | null
    // This person's role, and who makes which change on this repository.
    role: Role
    owners: Record<Action, Role>
  }
}

// The getting started guide of one board: whether the team confirmed how
// the board is read, and whether the guide is put away.
export interface Guide {
  readingConfirmed: boolean
  hidden: boolean
}

// Signing in with GitHub's device flow: the code to enter on GitHub while
// the plugin waits, then the result.
export interface AuthPayload {
  state: 'idle' | 'starting' | 'code' | 'error'
  userCode?: string
  url?: string
  error?: string
}

export interface RepoChoice {
  name: string
  private: boolean
}

export interface ProjectChoice {
  title: string
  url: string
}

export interface StatusPayload {
  state: 'loading' | 'ok' | 'warn' | 'error'
  text: string
}

// From the plugin to the window.
export interface BoardHandler extends EventHandler {
  name: 'BOARD'
  handler: (board: BoardPayload) => void
}
export interface StatusHandler extends EventHandler {
  name: 'STATUS'
  handler: (status: StatusPayload) => void
}
export interface WhyResultHandler extends EventHandler {
  name: 'WHY_RESULT'
  handler: (key: string, lines: Array<string> | null, error: string | null) => void
}
export interface SelectedHandler extends EventHandler {
  name: 'SELECTED'
  handler: (id: string | null) => void
}

export interface AuthHandler extends EventHandler {
  name: 'AUTH'
  handler: (auth: AuthPayload) => void
}
export interface ReposHandler extends EventHandler {
  name: 'REPOS'
  handler: (repos: Array<RepoChoice>) => void
}
export interface ProjectsHandler extends EventHandler {
  name: 'PROJECTS'
  handler: (projects: Array<ProjectChoice> | null) => void
}

// From the window to the plugin.
export interface SignInHandler extends EventHandler {
  name: 'SIGN_IN'
  handler: () => void
}
export interface CancelSignInHandler extends EventHandler {
  name: 'CANCEL_SIGN_IN'
  handler: () => void
}
export interface SaveTokenHandler extends EventHandler {
  name: 'SAVE_TOKEN'
  handler: (token: string) => void
}
export interface SelectRepoHandler extends EventHandler {
  name: 'SELECT_REPO'
  handler: (repo: string) => void
}
export interface SelectProjectHandler extends EventHandler {
  name: 'SELECT_PROJECT'
  handler: (url: string) => void
}
export interface ReadyHandler extends EventHandler {
  name: 'READY'
  handler: () => void
}
export interface RefreshHandler extends EventHandler {
  name: 'REFRESH'
  handler: () => void
}
export interface SetLegendHandler extends EventHandler {
  name: 'SET_LEGEND'
  handler: (hex: string, value: ItemType) => void
}
export interface SetModeHandler extends EventHandler {
  name: 'SET_MODE'
  handler: (mode: ReadingMode) => void
}
export interface SetRowTypeHandler extends EventHandler {
  name: 'SET_ROW_TYPE'
  handler: (row: string, value: ItemType) => void
}
export interface FocusHandler extends EventHandler {
  name: 'FOCUS'
  handler: (id: string, zoom: boolean) => void
}
export interface CompareHandler extends EventHandler {
  name: 'COMPARE'
  handler: (repo: string, project: string, token: string) => void
}
export interface WhyHandler extends EventHandler {
  name: 'WHY'
  handler: (key: string, number: number, kind: string) => void
}
export interface OpenHandler extends EventHandler {
  name: 'OPEN'
  handler: (url: string) => void
}
export interface LinkHandler extends EventHandler {
  name: 'LINK'
  handler: (id: string, number: number | null) => void
}
export interface ForgetTokenHandler extends EventHandler {
  name: 'FORGET_TOKEN'
  handler: () => void
}
export interface SetGuideHandler extends EventHandler {
  name: 'SET_GUIDE'
  handler: (change: Partial<Guide>) => void
}
export interface SetLabelsHandler extends EventHandler {
  name: 'SET_LABELS'
  handler: (on: boolean) => void
}
export interface SetWriteHandler extends EventHandler {
  name: 'SET_WRITE'
  handler: (allowed: boolean) => void
}
export interface SetPublishingHandler extends EventHandler {
  name: 'SET_PUBLISHING'
  handler: (change: Partial<Publishing>) => void
}
export interface PublishHandler extends EventHandler {
  name: 'PUBLISH'
  handler: (id: string, title: string, body: string) => void
}
export interface SetSizeHandler extends EventHandler {
  name: 'SET_SIZE'
  handler: (number: number, size: string | null) => void
}
// Settles one difference: the map is right (GitHub is changed), GitHub is
// right (the sticky is changed), or both are kept on purpose.
export interface ResolveHandler extends EventHandler {
  name: 'RESOLVE'
  handler: (id: string, key: string, side: 'map' | 'github' | 'keep') => void
}
export interface PublishManyHandler extends EventHandler {
  name: 'PUBLISH_MANY'
  handler: (ids: Array<string>) => void
}
export interface StartWeekHandler extends EventHandler {
  name: 'START_WEEK'
  handler: () => void
}
export interface SetRoleHandler extends EventHandler {
  name: 'SET_ROLE'
  handler: (role: Role) => void
}
export interface SetOwnerHandler extends EventHandler {
  name: 'SET_OWNER'
  handler: (action: Action, role: Role) => void
}
export interface AddTemplateHandler extends EventHandler {
  name: 'ADD_TEMPLATE'
  handler: () => void
}
export interface ResizeWindowHandler extends EventHandler {
  name: 'RESIZE_WINDOW'
  handler: (windowSize: { width: number; height: number }) => void
}
