// Storymap to GitHub, the plugin window, built with Create Figma Plugin's
// Preact components. It shows the map as a tree, the card of the selected
// sticky, where the map and GitHub drift apart, and the reading settings.
import {
  Button,
  Disclosure,
  Dropdown,
  IconButton,
  IconClose16,
  IconLockLocked16,
  IconPublish16,
  IconRefresh16,
  SearchTextbox,
  SegmentedControl,
  TextboxMultiline,
  Tabs,
  Textbox,
  Toggle,
  render,
  useWindowResize,
} from '@create-figma-plugin/ui'
import { emit, on } from '@create-figma-plugin/utilities'
import { Fragment, h } from 'preact'
import { useEffect, useState } from 'preact/hooks'

import { DEFAULT_BODY, draftIssue, driftKey, normalize, suggestIssues } from './core'
import type { Drift, Feature, ItemType, MapNode, Task } from './core'
import type {
  AuthHandler,
  AuthPayload,
  CancelSignInHandler,
  ProjectChoice,
  ProjectsHandler,
  RepoChoice,
  ReposHandler,
  SaveTokenHandler,
  SelectProjectHandler,
  SelectRepoHandler,
  SignInHandler,
  BoardHandler,
  BoardPayload,
  CompareHandler,
  FocusHandler,
  ForgetTokenHandler,
  IssueSummary,
  LinkHandler,
  OpenHandler,
  PublishHandler,
  ResolveHandler,
  SetSizeHandler,
  ReadyHandler,
  RefreshHandler,
  ResizeWindowHandler,
  SelectedHandler,
  SetGuideHandler,
  SetLabelsHandler,
  SetLegendHandler,
  SetModeHandler,
  SetPublishingHandler,
  SetRowTypeHandler,
  SetWriteHandler,
  StatusHandler,
  StatusPayload,
  WhyHandler,
  WhyResultHandler,
} from './types'
import styles from './ui.css'

type Kind = 'epic' | 'feature' | 'step' | 'task' | 'note'

const KIND_LABEL: Record<string, string> = { epic: 'Epic', feature: 'Feature', step: 'Step', task: 'Task', note: 'Note', ignore: 'Ignore' }
const TYPE_OPTIONS = (['epic', 'feature', 'step', 'task', 'note', 'ignore'] as Array<ItemType>).map((value) => ({ value, text: KIND_LABEL[value] }))
const TAB_NAMES = ['Map', 'Differences', 'Reading', 'GitHub']
const DRIFT_LABEL: Record<Drift['kind'], string> = { dropped: 'Dropped on GitHub', schedule: 'Planned too late', milestone: 'Milestone', parent: 'Parent', title: 'Title' }

// Where an item sits in the tree, found by its sticky id.
interface Located {
  item: MapNode & Partial<Task>
  kind: Kind
  parent: string | null
}

function locate(board: BoardPayload, id: string): Located | null {
  const b = board.backlog
  const inTasks = (tasks: Array<Task>, parent: string): Located | null => {
    for (const t of tasks) {
      if (t.id === id) return { item: t, kind: 'task', parent }
      const sub = inTasks(t.subtasks || [], t.title)
      if (sub) return sub
    }
    return null
  }
  const inFeature = (f: Feature, parent: string | null): Located | null => {
    if (f.id === id) return { item: f, kind: 'feature', parent }
    const step = f.steps.find((s) => s.id === id)
    if (step) return { item: step, kind: 'step', parent: f.title }
    return inTasks(f.tasks, f.title)
  }
  for (const e of b.epics) {
    if (e.id === id) return { item: e, kind: 'epic', parent: null }
    for (const f of e.features) {
      const found = inFeature(f, e.title)
      if (found) return found
    }
    const t = inTasks(e.tasks, e.title)
    if (t) return t
  }
  for (const f of b.looseFeatures) {
    const found = inFeature(f, null)
    if (found) return found
  }
  const note = b.notes.find((n) => n.id === id)
  if (note) return { item: note, kind: 'note', parent: null }
  return null
}

// The issue an item is, when linked by hand or by an identical title.
function issueOf(board: BoardPayload, id: string): IssueSummary | null {
  const m = board.matches[id]
  if (!m || (m.status !== 'linked' && m.status !== 'exists')) return null
  return board.issues.find((i) => i.number === m.number) || null
}

// The words of an issue title that a sticky shares with it, as written.
function sharedWords(title: string, stems: Array<string>): string {
  const words = normalize(title).split(' ').filter((w) => stems.includes(w.slice(0, 5)))
  return [...new Set(words)].join(', ')
}

// How many map items could be issues, and how many already are.
function linkProgress(board: BoardPayload) {
  const b = board.backlog
  const ids: Array<string> = []
  const tasks = (list: Array<Task>) => list.forEach((t) => { ids.push(t.id); tasks(t.subtasks || []) })
  const features = (list: Array<Feature>) => list.forEach((f) => { ids.push(f.id); tasks(f.tasks) })
  b.epics.forEach((e) => { ids.push(e.id); features(e.features); tasks(e.tasks) })
  features(b.looseFeatures)
  const linked = ids.filter((id) => issueOf(board, id)).length
  return { linked, total: ids.length }
}

// "just now", "3 min ago", "2 h ago".
function ago(time: number, now: number) {
  const minutes = Math.floor((now - time) / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  return `${Math.floor(minutes / 60)} h ago`
}

// The getting started guide: four steps, each ticked by what happens on the
// board or in the panel, never by a separate "done" button.
function Guide(props: { board: BoardPayload; now: number; goTo: (tab: string) => void }) {
  const { board } = props
  const b = board.backlog
  const progress = linkProgress(board)
  const connected = board.settings.issuesLoaded !== null
  const steps = [
    {
      title: 'Check how the board is read',
      done: board.guide.readingConfirmed,
      body: (
        <Fragment>
          <p class={styles.help}>
            Read {b.mode === 'rows' ? "by rows, as in Figma's story map template" : 'by sticky colours'}: {b.stats.epics} epics, {b.stats.features} features, {b.stats.tasks} tasks
            {b.milestones.length ? `, releases ${b.milestones.join(', ')}` : ', no releases'}.
          </p>
          <div class={styles.actions}>
            <Button onClick={() => emit<SetGuideHandler>('SET_GUIDE', { readingConfirmed: true })}>That's right</Button>
            <Button secondary onClick={() => props.goTo('Reading')}>Adjust</Button>
          </div>
        </Fragment>
      ),
    },
    {
      title: 'Connect GitHub',
      done: connected,
      body: connected ? (
        <p class={styles.help}>Connected to {board.settings.repo}{board.readAt ? `, updated ${ago(board.readAt, props.now)}` : ''}.</p>
      ) : (
        <Fragment>
          <p class={styles.help}>Name the repository where the team's issues live. The plugin reads them again every time it opens.</p>
          <div class={styles.actions}><Button onClick={() => props.goTo('GitHub')}>Connect</Button></div>
        </Fragment>
      ),
    },
    {
      title: 'Link your stickies to their issues',
      done: connected && progress.linked > 0,
      body: (
        <p class={styles.help}>
          {connected ? `${progress.linked} of ${progress.total} linked. ` : ''}Click a sticky on the board: its card shows the issues it most likely is.
        </p>
      ),
    },
    {
      title: 'Show labels on the board',
      done: board.labelsOn,
      body: connected ? (
        <Toggle value={board.labelsOn} onValueChange={(v: boolean) => emit<SetLabelsHandler>('SET_LABELS', v)}>Labels on the board</Toggle>
      ) : (
        <p class={styles.help}>Once connected, each linked sticky can show its issue number, sprint and status.</p>
      ),
    },
  ]
  // Only the step to do now is open; the guide goes away once all are done.
  const current = steps.findIndex((s) => !s.done)
  if (current === -1) return null
  const step = steps[current]
  return (
    <div class={styles.guide}>
      <div class={styles.guideHead}>
        <span class={styles.guideCount}>Get started · {current + 1} of {steps.length}</span>
        <span class={styles.guideDots}>
          {steps.map((s, i) => <span key={s.title} class={`${styles.guideDot} ${s.done ? styles.guideDotDone : i === current ? styles.guideDotNow : ''}`} />)}
        </span>
        <IconButton onClick={() => emit<SetGuideHandler>('SET_GUIDE', { hidden: true })} title="Hide the guide">
          <IconClose16 />
        </IconButton>
      </div>
      <div class={styles.guideTitle}>{step.title}</div>
      {step.body}
    </div>
  )
}

function Badge(props: { board: BoardPayload; id: string; onOpen: () => void }) {
  const m = props.board.matches[props.id]
  if (!m) return null
  const pill = (cls: string, text: string, tip: string) => (
    <button
      class={`${styles.pill} ${cls}`}
      title={`${tip}. Click to change.`}
      onClick={(e) => {
        e.stopPropagation()
        props.onOpen()
      }}
    >
      {text}
    </button>
  )
  if (m.status === 'linked') return pill(styles.pillExists, `#${m.number}`, `Linked to: ${m.title}`)
  if (m.status === 'exists') return pill(styles.pillExists, `#${m.number}`, `Same title as: ${m.title}`)
  if (m.status === 'maybe') return pill(styles.pillMaybe, `#${m.number}?`, `Close to: ${m.title}`)
  return pill(styles.pillNew, 'New', m.confirmed ? 'Marked as not on GitHub yet' : 'No issue with a close title')
}

function Plugin() {
  const [board, setBoard] = useState<BoardPayload | null>(null)
  const [status, setStatus] = useState<StatusPayload | null>(null)
  const [tab, setTab] = useState('Map')
  const [selected, setSelected] = useState<string | null>(null)
  const [filter, setFilter] = useState('all')
  const [sprintFilter, setSprintFilter] = useState('all')
  const [why, setWhy] = useState<Record<string, { loading?: boolean; lines?: Array<string> | null; error?: string | null }>>({})
  const [repo, setRepo] = useState('')
  const [project, setProject] = useState('')
  const [token, setToken] = useState('')
  const [search, setSearch] = useState('')
  const [copied, setCopied] = useState('')
  const [now, setNow] = useState(Date.now())
  // The title typed in the publish preview, and the sticky last published
  // from its card, to show how it went there.
  const [draftTitle, setDraftTitle] = useState('')
  const [draftBody, setDraftBody] = useState('')
  const [bodyTemplate, setBodyTemplate] = useState<string | null>(null)
  const [publishedFrom, setPublishedFrom] = useState<string | null>(null)
  const [auth, setAuth] = useState<AuthPayload>({ state: 'idle' })
  const [repos, setRepos] = useState<Array<RepoChoice> | null>(null)
  const [projects, setProjects] = useState<Array<ProjectChoice> | null>(null)
  const [repoSearch, setRepoSearch] = useState('')
  const [changingRepo, setChangingRepo] = useState(false)
  const [useToken, setUseToken] = useState(false)
  const [codeCopied, setCodeCopied] = useState(false)
  const [resolving, setResolving] = useState<string | null>(null)
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({ drifts: true })
  const [startLabel, setStartLabel] = useState<string | null>(null)
  const [startStatus, setStartStatus] = useState<string | null>(null)

  // Keeps "updated 3 min ago" true while the window stays open.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(timer)
  }, [])

  useWindowResize((size) => emit<ResizeWindowHandler>('RESIZE_WINDOW', size), { minWidth: 360, minHeight: 480, maxWidth: 900, maxHeight: 1400 })

  useEffect(() => {
    const offs = [
      on<BoardHandler>('BOARD', (next) => {
        setBoard(next)
        setRepo((r) => r || next.settings.repo)
        setProject((p) => p || next.settings.project)
      }),
      on<StatusHandler>('STATUS', setStatus),
      on<AuthHandler>('AUTH', setAuth),
      on<ReposHandler>('REPOS', setRepos),
      on<ProjectsHandler>('PROJECTS', setProjects),
      on<WhyResultHandler>('WHY_RESULT', (key, lines, error) => setWhy((w) => ({ ...w, [key]: { lines, error } }))),
      on<SelectedHandler>('SELECTED', (id) => {
        setSelected(id)
        setSearch('')
        setDraftTitle('')
        setDraftBody('')
        if (id) setTab('Map')
      }),
    ]
    emit<ReadyHandler>('READY')
    return () => offs.forEach((off) => off())
  }, [])

  if (!board) return <div class={styles.empty}>Reading the board…</div>

  const b = board.backlog
  const focus = (id: string, zoom: boolean) => emit<FocusHandler>('FOCUS', id, zoom)
  const open = (id: string) => {
    setSelected(id)
    setSearch('')
    setDraftTitle('')
    setDraftBody('')
    focus(id, true)
  }

  // Filters by release and by sprint; a task stays when one of its sub-tasks matches.
  const sprintOk = (t: Task) => {
    if (sprintFilter === 'all') return true
    const issue = issueOf(board, t.id)
    return sprintFilter === 'none' ? !(issue && issue.sprint) : Boolean(issue && issue.sprint === sprintFilter)
  }
  const matches = (t: Task) => sprintOk(t) && (filter === 'all' || (filter === 'none' ? !t.release : t.release === filter))
  const keep = (t: Task): boolean => matches(t) || (t.subtasks || []).some(keep)
  const filtering = filter !== 'all' || sprintFilter !== 'all'

  const row = (item: MapNode & Partial<Task>, kind: Kind) => {
    const issue = kind === 'task' ? issueOf(board, item.id) : null
    const tip = issue ? [issue.status, issue.size && `size ${issue.size}`, issue.assignees.length ? `@${issue.assignees.join(', @')}` : ''].filter(Boolean).join(', ') : ''
    return (
      <div
        class={`${styles.row} ${selected === item.id ? styles.rowSelected : ''}`}
        tabIndex={0}
        onMouseEnter={() => focus(item.id, false)}
        onClick={() => open(item.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            open(item.id)
          }
        }}
      >
        <span class={`${styles.dot} ${styles[kind]}`} title={KIND_LABEL[kind]} />
        <span class={`${styles.label} ${kind === 'epic' ? styles.labelStrong : ''}`} title={`${KIND_LABEL[kind]}: ${item.title}`}>
          {item.title}
        </span>
        {item.release ? <span class={`${styles.pill} ${styles.pillMilestone}`}>{item.release}</span> : null}
        {issue && issue.sprint ? <span class={`${styles.pill} ${styles.pillSprint}`} title={tip}>{issue.sprint}</span> : null}
        {kind !== 'step' && kind !== 'note' ? <Badge board={board} id={item.id} onOpen={() => open(item.id)} /> : null}
      </div>
    )
  }

  const taskTree = (t: Task): h.JSX.Element => {
    const subs = (t.subtasks || []).filter(keep)
    return (
      <li key={t.id}>
        {row(t, 'task')}
        {subs.length ? <ul>{subs.map(taskTree)}</ul> : null}
      </li>
    )
  }

  const featureTree = (f: Feature) => {
    const tasks = f.tasks.filter(keep)
    if (filtering && !tasks.length) return null
    return (
      <li key={f.id}>
        {row(f, 'feature')}
        {f.steps.length ? <div class={styles.steps}>Steps: {f.steps.map((s) => s.title).join(' · ')}</div> : null}
        {tasks.length ? <ul>{tasks.map(taskTree)}</ul> : null}
      </li>
    )
  }

  // The card of the selected sticky ---------------------------------------
  const card = () => {
    if (!selected) return null
    const found = locate(board, selected)
    if (!found) {
      return (
        <div class={styles.card}>
          <div class={styles.cardHead}>
            <span class={styles.cardTitle}>Not part of the map</span>
            <button class={styles.close} onClick={() => setSelected(null)} aria-label="Close">✕</button>
          </div>
          <p class={styles.help}>This node is a label, a legend sticky, or a colour or row the map ignores. Change that in Legend.</p>
        </div>
      )
    }
    const { item, kind, parent } = found
    const issue = issueOf(board, item.id)
    const m = board.matches[item.id]
    const linkTo = (n: number | null) => emit<LinkHandler>('LINK', item.id, n)
    const canLink = kind !== 'step' && kind !== 'note'
    const candidates = canLink && board.issues.length ? suggestIssues(item.title, kind, board.issues.map((i) => ({ number: i.number, title: i.title }))) : []
    const searched = search.trim()
      ? board.issues.filter((i) => `#${i.number} ${i.title}`.toLowerCase().includes(search.trim().toLowerCase())).slice(0, 8)
      : []
    return (
      <div class={styles.card}>
        <div class={styles.cardHead}>
          <span class={`${styles.dot} ${styles[kind]}`} />
          <span class={styles.cardTitle}>{item.title}</span>
          <button class={styles.close} onClick={() => setSelected(null)} aria-label="Close">✕</button>
        </div>
        <div class={styles.cardMeta}>
          {KIND_LABEL[kind]}
          {parent ? ` in ${parent}` : ''}
          {item.release ? ` · ${item.release}` : ''}
        </div>
        {!canLink ? <p class={styles.help}>{kind === 'step' ? 'Steps are written in their feature, not as issues.' : 'Notes stay on the board, not on GitHub.'}</p> : null}
        {canLink && board.settings.issuesLoaded === null ? (
          <p class={styles.help}>
            Connect a repository in <button class={styles.linkButton} onClick={() => setTab('GitHub')}>GitHub</button> to see this sticky's issue.
          </p>
        ) : null}
        {canLink && issue ? (
          <div class={styles.cardIssue}>
            <button class={styles.linkButton} onClick={() => issue.url && emit<OpenHandler>('OPEN', issue.url)}>
              #{issue.number} {issue.title}
            </button>
            <div class={styles.cardMeta}>
              {[issue.state === 'closed' ? 'Closed' : issue.status || 'Open', issue.sprint, issue.size && `size ${issue.size}`, issue.assignees.length ? `@${issue.assignees.join(', @')}` : 'no one assigned']
                .filter(Boolean)
                .join(' · ')}
            </div>
            {board.settings.sizeOptions ? (
              <div class={styles.sizeRow}>
                <span class={styles.fieldLabel}>Size</span>
                {board.settings.writeAllowed ? (
                  <SegmentedControl
                    value={issue.size || 'none'}
                    options={[{ value: 'none', children: 'None' }, ...board.settings.sizeOptions.map((o) => ({ value: o, children: o }))]}
                    onValueChange={(v: string) => {
                      setPublishedFrom(item.id)
                      emit<SetSizeHandler>('SET_SIZE', issue.number, v === 'none' ? null : v)
                    }}
                  />
                ) : (
                  <span>{issue.size || 'No size'}</span>
                )}
              </div>
            ) : null}
            <div class={styles.actions}>
              <Button secondary onClick={() => linkTo(0)}>Not this issue</Button>
            </div>
          </div>
        ) : null}
        {canLink && !issue && board.issues.length ? (
          <Fragment>
            <p class={styles.question}>{m && m.confirmed ? 'Marked as not on GitHub yet.' : 'Already on GitHub? Pick its issue'}</p>
            {candidates.map((c) => (
              <button key={c.number} class={styles.candidate} onClick={() => linkTo(c.number)}>
                #{c.number} {c.title}
                <span class={styles.candidateWhy}>{c.score > 1 ? 'Same title' : `Words in common: ${sharedWords(c.title, c.shared)}`}</span>
              </button>
            ))}
            {!candidates.length ? <p class={styles.help}>No issue has a close title.</p> : null}
            <SearchTextbox value={search} onValueInput={setSearch} placeholder="Search another issue" />
            {searched.map((i) => (
              <button key={i.number} class={styles.candidate} onClick={() => linkTo(i.number)}>
                #{i.number} {i.title}
              </button>
            ))}
            <div class={styles.actions}>
              {!(m && m.confirmed) ? <Button secondary onClick={() => linkTo(0)}>None of these</Button> : null}
              {m && (m.status === 'linked' || m.confirmed) ? <Button secondary onClick={() => linkTo(null)}>Guess from the title</Button> : null}
            </div>
          </Fragment>
        ) : null}
        {canLink && !issue ? publishBox(item.id) : null}
        {publishedFrom === item.id && status ? <div class={`${styles.notice} ${styles[status.state === 'loading' ? 'info' : status.state]}`} role="status">{status.text}</div> : null}
      </div>
    )
  }

  // The issue a sticky would become, with what it will carry, before
  // anything is written. Publishing is off until the team allows it for
  // this repository in the GitHub tab.
  const publishBox = (id: string) => {
    const { meta, publishing, writeAllowed, repo: repoName, project: projectUrl } = board.settings
    if (!meta) return null
    const draft = draftIssue(id, b, board.matches, meta, publishing)
    if (!draft) return null
    const busy = status !== null && status.state === 'loading'
    const title = draftTitle || draft.title
    const text = draftBody || draft.body
    const lines: Array<[string, string]> = [
      ['Type', draft.type ? draft.type : `label "${draft.kind}" (no ${KIND_LABEL[draft.kind]} type here)`],
      ['Parent', draft.parent ? (draft.parent.number ? `#${draft.parent.number} ${draft.parent.title}` : `${draft.parent.title}, not on GitHub yet`) : 'None'],
      ['Milestone', draft.milestone ? draft.milestone.title : 'None'],
      ['Labels', draft.labels.length ? draft.labels.join(', ') : 'None'],
    ]
    if (projectUrl) lines.push(['On the board', draft.status || 'Added, without status'])
    return (
      <div class={styles.publish}>
        <p class={styles.question}>Not yet? Create its issue in {repoName}</p>
        <span class={styles.fieldLabel}>Title</span>
        <Textbox value={title} onValueInput={setDraftTitle} spellCheck={false} />
        <span class={styles.fieldLabel} style={{ marginTop: 8 }}>Story and acceptance criteria</span>
        <TextboxMultiline value={text} onValueInput={setDraftBody} rows={9} grow spellCheck />
        <dl class={styles.draft}>
          {lines.map(([k, v]) => (
            <Fragment key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </Fragment>
          ))}
        </dl>
        {draft.warnings.map((w) => (
          <div key={w} class={`${styles.notice} ${styles.warn}`}>{w}</div>
        ))}
        {writeAllowed ? (
          <div class={styles.actions}>
            <Button
              disabled={busy || !title.trim()}
              onClick={() => {
                setPublishedFrom(id)
                emit<PublishHandler>('PUBLISH', id, title, text)
              }}
            >
              Create the issue
            </Button>
          </div>
        ) : (
          <p class={styles.help}>
            Changes to {repoName} are off. Allow them in <button class={styles.linkButton} onClick={() => setTab('GitHub')}>GitHub</button> to publish from here.
          </p>
        )}
      </div>
    )
  }

  // Tabs ------------------------------------------------------------------
  const preview = () => {
    const total = b.stats.epics + b.stats.features + b.stats.tasks
    if (!total) {
      return (
        <div class={styles.empty}>
          <p><b>No story map found here</b></p>
          <p>Open the page that holds the story map, then press Refresh. Check Legend if the board uses other colours or rows.</p>
        </div>
      )
    }
    const releases = ['all', ...b.milestones, ...(b.stats.withoutMilestone ? ['none'] : [])]
    const progress = linkProgress(board)
    return (
      <Fragment>
        {card()}
        {!board.guide.hidden && !selected ? <Guide board={board} now={now} goTo={setTab} /> : null}
        <div class={styles.overview}>
          <div class={styles.overviewLine}>
            <span>
              {b.stats.epics} epics · {b.stats.features} features · {b.stats.tasks} tasks
            </span>
            {board.issues.length ? (
              <span class={styles.inlineToggle} title="Show each linked sticky's issue, sprint and status on the board">
                <Toggle value={board.labelsOn} onValueChange={(v: boolean) => emit<SetLabelsHandler>('SET_LABELS', v)}>
                  Labels
                </Toggle>
              </span>
            ) : null}
          </div>
          {board.settings.issuesLoaded !== null ? (
            <div class={styles.progress} title={`${progress.linked} of ${progress.total} stickies linked to an issue`}>
              <div class={styles.progressBar} style={{ width: `${progress.total ? Math.round((progress.linked / progress.total) * 100) : 0}%` }} />
              <span class={styles.progressText}>{progress.linked} of {progress.total} linked to GitHub</span>
            </div>
          ) : null}
          {b.milestones.length || board.sprints.length ? (
            <div class={styles.filters}>
              {b.milestones.length ? (
                <Dropdown
                  value={filter}
                  options={releases.map((r) => ({ value: r, text: r === 'all' ? 'All releases' : r === 'none' ? 'No release' : r }))}
                  onValueChange={setFilter}
                />
              ) : null}
              {board.sprints.length ? (
                <Dropdown
                  value={sprintFilter}
                  options={[
                    { value: 'all', text: 'All sprints' },
                    ...board.sprints.map((x) => ({ value: x.title, text: `${x.title} · ends ${x.end.slice(5)}` })),
                    { value: 'none', text: 'Not in a sprint' },
                  ]}
                  onValueChange={setSprintFilter}
                />
              ) : null}
            </div>
          ) : null}
          <div class={styles.kinds}>
            {(['epic', 'feature', 'task'] as Array<Kind>).map((k) => (
              <span key={k}><span class={`${styles.dot} ${styles[k]}`} /> {KIND_LABEL[k]}</span>
            ))}
            {b.notes.length ? <span><span class={`${styles.dot} ${styles.note}`} /> Note</span> : null}
          </div>
        </div>
        {b.unmapped.length ? <div class={`${styles.notice} ${styles.warn}`}>{b.unmapped.length} colour(s) not read yet. Set them in <button class={styles.linkButton} onClick={() => setTab('Reading')}>Reading</button>.</div> : null}
        {b.orphans.length ? <div class={`${styles.notice} ${styles.warn}`}>{b.orphans.length} item(s) have no parent column. They are listed at the bottom.</div> : null}
        <ul class={styles.tree}>
          {b.epics.map((e) => {
            const inner = [...e.features.map(featureTree).filter(Boolean), ...e.tasks.filter(keep).map(taskTree)]
            if (filtering && !inner.length) return null
            return (
              <li key={e.id}>
                {row(e, 'epic')}
                {inner.length ? <ul>{inner}</ul> : null}
              </li>
            )
          })}
          {b.looseFeatures.map(featureTree)}
        </ul>
        {b.notes.length ? (
          <Fragment>
            <p class={styles.sectionTitle}>Notes, not issues</p>
            <ul class={styles.tree}>{b.notes.map((n) => <li key={n.id}>{row(n, 'note')}</li>)}</ul>
          </Fragment>
        ) : null}
        {b.orphans.length ? (
          <Fragment>
            <p class={styles.sectionTitle}>Without a parent</p>
            <ul class={styles.tree}>{b.orphans.map((o) => <li key={o.id}>{row(o, (o.kind as Kind) || 'task')}</li>)}</ul>
          </Fragment>
        ) : null}
      </Fragment>
    )
  }

  // The three ways to settle a difference. "The map is right" changes GitHub
  // and needs write access; "GitHub is right" changes the sticky (titles
  // only); "Keep both" hides it until either side changes.
  const settle = (x: Drift) => {
    const key = driftKey(x)
    const go = (side: 'map' | 'github' | 'keep') => {
      setResolving(key)
      emit<ResolveHandler>('RESOLVE', x.id, key, side)
    }
    const mapLabel: Record<string, string> = {
      title: 'Rename the issue',
      milestone: x.target ? `Set milestone ${x.target}` : 'Remove the milestone',
      parent: `Move under #${x.target}`,
    }
    const canFix = x.kind in mapLabel
    return (
      <div class={styles.settle}>
        {canFix ? (
          board.settings.writeAllowed ? (
            <Button onClick={() => go('map')} title="The map is right: change GitHub">
              {mapLabel[x.kind]}
            </Button>
          ) : (
            <span class={styles.help}>To change GitHub from here, choose Can write in GitHub.</span>
          )
        ) : null}
        {x.kind === 'title' ? (
          <Button secondary onClick={() => go('github')} title="GitHub is right: change the sticky">
            Rename the sticky
          </Button>
        ) : null}
        <Button secondary onClick={() => go('keep')} title="Both are right: stop showing this difference">
          Keep both
        </Button>
      </div>
    )
  }

  const toggleSection = (key: string) => setOpenSections((o) => ({ ...o, [key]: !o[key] }))

  const drift = () => {
    const d = board.drift
    if (!d) {
      return (
        <div class={styles.empty}>
          <p><b>Connect a repository first</b></p>
          <p>
            In <button class={styles.linkButton} onClick={() => setTab('GitHub')}>GitHub</button>, sign in and pick the repository of this map.
          </p>
        </div>
      )
    }
    return (
      <Fragment>
        {resolving && status ? <div class={`${styles.notice} ${styles[status.state === 'loading' ? 'info' : status.state]}`} role="status">{status.text}</div> : null}
        {d.drifts.length ? (
          <p class={styles.lead}>{d.drifts.length === 1 ? 'One place' : `${d.drifts.length} places`} where the map and GitHub disagree. Pick which side is right; nothing changes until you do.</p>
        ) : (
          <div class={`${styles.notice} ${styles.ok}`}>The linked stickies and their issues agree.</div>
        )}
        {d.drifts.map((x) => {
          const key = `${x.id}:${x.kind}:${x.number}`
          const w = why[key]
          return (
            <div class={styles.drift} key={key}>
              <div class={styles.driftHead}>
                <span class={`${styles.pill} ${styles.pillMaybe}`}>{DRIFT_LABEL[x.kind]}</span>
                <button class={`${styles.linkButton} ${styles.label}`} onClick={() => open(x.id)}>{x.title}</button>
                <button class={styles.linkButton} onClick={() => x.url && emit<OpenHandler>('OPEN', x.url)}>#{x.number}</button>
              </div>
              <div class={styles.driftSides}>
                <span class={styles.driftSide}>Map</span><span>{x.board}</span>
                <span class={styles.driftSide}>GitHub</span><span>{x.github}</span>
              </div>
              {settle(x)}
              {!w ? (
                <Button
                  secondary
                  onClick={() => {
                    setWhy((all) => ({ ...all, [key]: { loading: true } }))
                    emit<WhyHandler>('WHY', key, x.number, x.kind)
                  }}
                >
                  Why?
                </Button>
              ) : w.loading ? (
                <p class={styles.help}>Reading the history…</p>
              ) : w.error ? (
                <p class={styles.help}>{w.error}</p>
              ) : w.lines && w.lines.length ? (
                <ul class={styles.history}>{w.lines.map((l) => <li key={l}>{l}</li>)}</ul>
              ) : (
                <p class={styles.help}>No change recorded on GitHub: it has differed since the issue was written.</p>
              )}
            </div>
          )
        })}
        {d.toConfirm.length ? (
          <Disclosure open={Boolean(openSections.confirm)} onClick={() => toggleSection('confirm')} title={`Close titles to confirm · ${d.toConfirm.length}`}>
            {d.toConfirm.map((i) => (
              <div class={styles.row} key={i.id} onClick={() => open(i.id)} onMouseEnter={() => focus(i.id, false)}>
                <span class={`${styles.dot} ${styles[i.kind as Kind] || ''}`} title={KIND_LABEL[i.kind]} />
                <span class={styles.label}>{i.title}</span>
                <span class={`${styles.pill} ${styles.pillMaybe}`}>#{i.number}?</span>
              </div>
            ))}
          </Disclosure>
        ) : null}
        {d.onlyOnBoard.length ? (
          <Disclosure open={Boolean(openSections.board)} onClick={() => toggleSection('board')} title={`On the map only · ${d.onlyOnBoard.length}`}>
            {d.onlyOnBoard.map((i) => (
              <div class={styles.row} key={i.id} onClick={() => open(i.id)} onMouseEnter={() => focus(i.id, false)}>
                <span class={`${styles.dot} ${styles[i.kind as Kind] || ''}`} title={KIND_LABEL[i.kind]} />
                <span class={styles.label}>{i.title}</span>
              </div>
            ))}
          </Disclosure>
        ) : null}
        {d.onlyOnGitHub.length ? (
          <Disclosure open={Boolean(openSections.github)} onClick={() => toggleSection('github')} title={`On GitHub only · ${d.onlyOnGitHub.length} open issues`}>
            {d.onlyOnGitHub.map((i) => (
              <div class={styles.row} key={i.number} onClick={() => i.url && emit<OpenHandler>('OPEN', i.url)}>
                <span class={styles.label}>#{i.number} {i.title}</span>
                {i.milestone ? <span class={`${styles.pill} ${styles.pillMilestone}`}>{i.milestone}</span> : null}
              </div>
            ))}
          </Disclosure>
        ) : null}
      </Fragment>
    )
  }

  const legend = () => {
    const byRows = b.mode === 'rows'
    const types = Object.entries(board.nodeTypes).sort((x, y) => y[1] - x[1]).map(([t, c]) => `${c} ${t.toLowerCase().replace(/_/g, ' ')}`).join(', ')
    return (
      <Fragment>
        <div style={{ margin: '12px 0 8px' }}>
          <SegmentedControl
            value={board.settings.mode}
            onValueChange={(v: string) => emit<SetModeHandler>('SET_MODE', v as BoardPayload['settings']['mode'])}
            options={[{ value: 'auto', children: 'Automatic' }, { value: 'rows', children: 'By rows' }, { value: 'colours', children: 'By colours' }]}
          />
        </div>
        <p class={styles.help}>
          {byRows
            ? "Read by rows, as in Figma's story map template: each labelled row gives the kind of the stickies in it. Release rows become milestones."
            : 'Read by colours: each sticky colour gives one kind of item.'}
          {board.settings.mode === 'auto' ? ' Chosen automatically.' : ''}
        </p>
        {byRows
          ? b.rows.map((r) => (
              <div class={styles.legendRow} key={r.name}>
                <span class={`${styles.swatch} ${styles.rowMark}`}>{r.kind === 'release' ? 'R' : r.name.slice(0, 1).toUpperCase()}</span>
                <div>
                  <div>{r.name}</div>
                  <div class={styles.samples}>{r.count} {r.count === 1 ? 'sticky' : 'stickies'}{r.kind === 'release' ? ', milestone' : ''}</div>
                </div>
                <Dropdown value={r.type} options={TYPE_OPTIONS} onValueChange={(v: string) => emit<SetRowTypeHandler>('SET_ROW_TYPE', r.name, v as ItemType)} />
              </div>
            ))
          : board.palette.map((c) => (
              <div class={styles.legendRow} key={c.hex}>
                <span class={styles.swatch} style={{ background: c.hex }} />
                <div>
                  <div>{c.count} {c.hue} {c.count > 1 ? 'stickies' : 'sticky'}</div>
                  <div class={styles.samples} title={c.samples.join(' · ')}>{c.samples.join(' · ')}</div>
                </div>
                <Dropdown value={board.legend[c.hex] || 'ignore'} options={TYPE_OPTIONS} onValueChange={(v: string) => emit<SetLegendHandler>('SET_LEGEND', c.hex, v as ItemType)} />
              </div>
            ))}
        <p class={styles.help}>
          Read on this page: {types || 'nothing'}. {b.stats.ignored} stickies skipped (legend, labels, empty or ignored).
        </p>
      </Fragment>
    )
  }

  // Copies with a hidden text area: the Clipboard API is blocked in plugin windows.
  const copyText = (text: string) => {
    const area = document.createElement('textarea')
    area.value = text
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    return ok
  }

  // Connecting takes three choices: sign in, pick a repository, pick its
  // project board. What the plugin may do there comes last; the rest of the
  // settings wait under "More settings".
  const github = () => {
    const s = board.settings
    const signedIn = Boolean(s.login)
    const query = repoSearch.trim().toLowerCase()
    const shown = (repos || []).filter((r) => r.name.toLowerCase().includes(query)).slice(0, 8)
    const typed = /^[\w.-]+\/[\w.-]+$/.test(repoSearch.trim()) && !(repos || []).some((r) => r.name.toLowerCase() === query)
    const pickRepo = (name: string) => {
      setChangingRepo(false)
      setRepoSearch('')
      setRepo(name)
      emit<SelectRepoHandler>('SELECT_REPO', name)
    }
    return (
      <Fragment>
        <div style={{ height: 12 }} />
        {status ? <div class={`${styles.notice} ${styles[status.state === 'loading' ? 'info' : status.state]}`} role="status">{status.text}</div> : null}

        <div class={styles.setupStep}>
          <span class={styles.stepTitle}>1. Your GitHub account</span>
          {auth.state === 'error' ? <div class={`${styles.notice} ${styles.error}`}>{auth.error}</div> : null}
          {signedIn ? (
            <div class={styles.stepRow}>
              <span>Connected as <strong>@{s.login}</strong></span>
              <Button secondary onClick={() => emit<ForgetTokenHandler>('FORGET_TOKEN')}>Sign out</Button>
            </div>
          ) : null}
          {signedIn ? (
            <p class={styles.help}>
              The plugin can read and change issues in the repositories your account can reach; it only writes where you choose "Create issues". Signing out forgets the token here; revoke it on{' '}
              <button class={styles.linkButton} onClick={() => emit<OpenHandler>('OPEN', 'https://github.com/settings/applications')}>GitHub</button>.
            </p>
          ) : auth.state === 'code' ? (
            <Fragment>
              <p class={styles.help}>Enter this code on GitHub, then authorize Storymap to GitHub.</p>
              <div class={styles.userCode}>{auth.userCode}</div>
              <div class={styles.actions}>
                <Button
                  onClick={() => {
                    setCodeCopied(copyText(auth.userCode || ''))
                    if (auth.url) emit<OpenHandler>('OPEN', auth.url)
                  }}
                >
                  {codeCopied ? 'Code copied, opening GitHub' : 'Copy the code and open GitHub'}
                </Button>
                <Button secondary onClick={() => emit<CancelSignInHandler>('CANCEL_SIGN_IN')}>Cancel</Button>
              </div>
              <p class={styles.help}>Waiting for GitHub…</p>
            </Fragment>
          ) : s.hasToken ? (
            <div class={styles.stepRow}>
              <span>Connected with a token</span>
              <Button secondary onClick={() => emit<ForgetTokenHandler>('FORGET_TOKEN')}>Forget it</Button>
            </div>
          ) : (
            <Fragment>
              <div class={styles.actions}>
                <Button
                  disabled={auth.state === 'starting'}
                  onClick={() => {
                    setCodeCopied(false)
                    emit<SignInHandler>('SIGN_IN')
                  }}
                >
                  Connect with GitHub
                </Button>
              </div>
              {useToken ? (
                <div class={styles.field}>
                  <span class={styles.fieldLabel}>Or paste a token (classic: repo, project, read:org)</span>
                  <Textbox value={token} onValueInput={setToken} password placeholder="ghp_…" />
                  <div class={styles.actions}>
                    <Button
                      secondary
                      disabled={!token.trim()}
                      onClick={() => {
                        emit<SaveTokenHandler>('SAVE_TOKEN', token)
                        setToken('')
                      }}
                    >
                      Use this token
                    </Button>
                  </div>
                </div>
              ) : (
                <p class={styles.help}>
                  Opens GitHub to approve, nothing to copy by hand. <button class={styles.linkButton} onClick={() => setUseToken(true)}>Use a token instead</button>
                </p>
              )}
            </Fragment>
          )}
        </div>

        {s.hasToken ? (
          <div class={styles.setupStep}>
            <span class={styles.stepTitle}>2. Repository</span>
            {s.repo && !changingRepo ? (
              <div class={styles.stepRow}>
                <strong>{s.repo}</strong>
                <Button secondary onClick={() => setChangingRepo(true)}>Change</Button>
              </div>
            ) : (
              <Fragment>
                <SearchTextbox value={repoSearch} onValueInput={setRepoSearch} placeholder={repos ? `Search ${repos.length} repositories` : 'Loading your repositories…'} />
                {shown.map((r) => (
                  <button key={r.name} class={styles.candidate} onClick={() => pickRepo(r.name)}>
                    {r.name}
                    {r.private ? <span class={styles.candidateWhy}>Private</span> : null}
                  </button>
                ))}
                {typed ? <button class={styles.candidate} onClick={() => pickRepo(repoSearch.trim())}>Use {repoSearch.trim()}</button> : null}
                {s.repo ? <Button secondary onClick={() => setChangingRepo(false)}>Keep {s.repo}</Button> : null}
              </Fragment>
            )}
          </div>
        ) : null}

        {s.hasToken && s.repo && !changingRepo ? (
          <div class={styles.setupStep}>
            <span class={styles.stepTitle}>3. Project board, for sprints and status</span>
            {projects === null ? (
              <p class={styles.help}>Looking for the boards of {s.repo}…</p>
            ) : (
              <Dropdown
                value={s.project || 'none'}
                options={[{ value: 'none', text: projects.length ? 'No board' : 'This repository has no board' }, ...projects.map((p) => ({ value: p.url, text: p.title }))]}
                onValueChange={(v: string) => emit<SelectProjectHandler>('SELECT_PROJECT', v === 'none' ? '' : v)}
              />
            )}
          </div>
        ) : null}

        {s.hasToken && s.repo && s.meta && !changingRepo ? writing() : null}
      </Fragment>
    )
  }

  // Writing to GitHub: off by default, per repository, with the values a
  // new issue starts with, which each team sets to its own words.
  const writing = () => {
    const { repo: repoName, meta, publishing, writeAllowed } = board.settings
    const save = (change: { startLabel?: string; startStatus?: string; bodyTemplate?: string }) => emit<SetPublishingHandler>('SET_PUBLISHING', change)
    return (
      <div class={styles.publish}>
        <span class={styles.stepTitle}>4. What the plugin may do in {repoName}</span>
        <SegmentedControl
          value={writeAllowed ? 'write' : 'read'}
          options={[{ value: 'read', children: 'Read only' }, { value: 'write', children: 'Can write' }]}
          onValueChange={(v: string) => emit<SetWriteHandler>('SET_WRITE', v === 'write')}
        />
        <p class={styles.help}>
          {writeAllowed
            ? "From a sticky's card you can create its issue, after a preview, and set its size on the board. Nothing else is changed."
            : 'The plugin only reads GitHub. This is the default for every repository.'}
        </p>
        {meta && !meta.canPush ? <div class={`${styles.notice} ${styles.warn}`}>Your account cannot write to {repoName}: creating issues will fail.</div> : null}
        <details class={styles.more}>
          <summary>More settings</summary>
        <div class={styles.field}>
          <span class={styles.fieldLabel}>Label of a new issue (empty for none)</span>
          <Textbox
            value={startLabel === null ? publishing.startLabel : startLabel}
            onValueInput={setStartLabel}
            onBlur={() => startLabel !== null && save({ startLabel: startLabel.trim() })}
            spellCheck={false}
          />
        </div>
        <div class={styles.field}>
          <span class={styles.fieldLabel}>Status of a new issue on the project board (empty for none)</span>
          <Textbox
            value={startStatus === null ? publishing.startStatus : startStatus}
            onValueInput={setStartStatus}
            onBlur={() => startStatus !== null && save({ startStatus: startStatus.trim() })}
            spellCheck={false}
          />
        </div>
        <div class={styles.field}>
          <span class={styles.fieldLabel}>Text of a new issue. {'{title}'}, {'{parent}'}, {'{release}'} and {'{steps}'} are filled in.</span>
          <TextboxMultiline
            value={bodyTemplate === null ? publishing.bodyTemplate || DEFAULT_BODY : bodyTemplate}
            onValueInput={setBodyTemplate}
            onBlur={() => bodyTemplate !== null && save({ bodyTemplate: bodyTemplate.trim() === DEFAULT_BODY ? '' : bodyTemplate })}
            rows={8}
            grow
          />
          {publishing.bodyTemplate ? (
            <button class={styles.linkButton} onClick={() => { setBodyTemplate(null); save({ bodyTemplate: '' }) }}>Back to the default text</button>
          ) : null}
        </div>
        </details>
      </div>
    )
  }

  const tabContent: Record<string, () => h.JSX.Element> = { Map: preview, Differences: drift, Reading: legend, GitHub: github }

  return (
    <div class={styles.app}>
      <div class={styles.header}>
        <div class={styles.headerText}>
          <div class={styles.headerRepo}>
            {board.settings.repo ? (
              <button class={styles.headerLink} onClick={() => setTab('GitHub')} title="Change the repository">
                {board.settings.repo}
              </button>
            ) : (
              <button class={styles.headerLink} onClick={() => setTab('GitHub')}>Connect GitHub</button>
            )}
          </div>
          <div class={styles.scope}>
            Page {board.page}
            {board.settings.issuesLoaded !== null ? ` · ${board.settings.issuesLoaded} issues` : ''}
            {board.readAt ? ` · updated ${ago(board.readAt, now)}` : ''}
          </div>
        </div>
        {board.guide.hidden ? <Button secondary onClick={() => { emit<SetGuideHandler>('SET_GUIDE', { hidden: false }); setTab('Map') }}>Guide</Button> : null}
        <IconButton onClick={() => emit<RefreshHandler>('REFRESH')} title="Read the board and GitHub again">
          <IconRefresh16 />
        </IconButton>
      </div>
      <Tabs value={tab} onValueChange={setTab} options={TAB_NAMES.map((value) => ({ value, children: null }))} />
      <div class={styles.main}>{tabContent[tab]()}</div>
      <div class={styles.footer}>
        <button class={styles.mode} onClick={() => setTab('GitHub')} title="What the plugin may do on GitHub">
          {board.settings.writeAllowed ? <IconPublish16 /> : <IconLockLocked16 />}
          {board.settings.writeAllowed ? 'Can write' : 'Read only'}
        </button>
        <Button
          secondary
          onClick={() => {
            const area = document.createElement('textarea')
            area.value = board.markdown
            document.body.appendChild(area)
            area.select()
            const ok = document.execCommand('copy')
            area.remove()
            setCopied(ok ? 'Copied' : 'Copy failed')
            setTimeout(() => setCopied(''), 1500)
          }}
        >
          {copied || 'Copy Markdown'}
        </Button>
      </div>
    </div>
  )
}

export default render(Plugin)
