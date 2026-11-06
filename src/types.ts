// Messages between the plugin code (main.ts) and its window (ui.tsx), in the
// typed style of Create Figma Plugin's `emit` and `on`.
import { EventHandler } from '@create-figma-plugin/utilities'

import type { Backlog, DriftReport, ItemType, Matches, PaletteEntry, ReadingMode, Sprint } from './core'

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
  // When GitHub was last read, in milliseconds since 1970; null if never.
  readAt: number | null
  settings: {
    repo: string
    project: string
    mode: ReadingMode
    hasToken: boolean
    issuesLoaded: number | null
  }
}

// The getting started guide of one board: whether the team confirmed how
// the board is read, and whether the guide is put away.
export interface Guide {
  readingConfirmed: boolean
  hidden: boolean
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

// From the window to the plugin.
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
export interface ResizeWindowHandler extends EventHandler {
  name: 'RESIZE_WINDOW'
  handler: (windowSize: { width: number; height: number }) => void
}
