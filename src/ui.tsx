// Storymap to GitHub, the plugin window, built with Create Figma Plugin's
// Preact components. It shows the map as a tree, the card of the selected
// sticky, where the map and GitHub drift apart, and the reading settings.
import {
  Button,
  Checkbox,
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

import { ACTIONS, TYPES, canDo, defaultBody, draftIssue, driftKey, normalize, suggestIssues } from './core'
import type { Action, Drift, Feature, ItemType, MapNode, Role, Task } from './core'
import { getLang, plural, resolveLang, setLang, t } from './i18n'
import type { LangSetting } from './i18n'
import type {
  AddTemplateHandler,
  SetOwnerHandler,
  SetRoleHandler,
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
  SetRowTypeHandler,
  SetWriteHandler,
  StatusHandler,
  StatusPayload,
  WhyHandler,
  WhyResultHandler,
} from './types'
import styles from './ui.css'

type Kind = 'epic' | 'feature' | 'step' | 'task' | 'note'

// Texts are written in English and translated by t() when shown (i18n.js),
// so the lists below hold English and are translated where they are used.
// The English kind names are also GitHub's issue type names.
const KIND_LABEL: Record<string, string> = { epic: 'Epic', feature: 'Feature', step: 'Step', task: 'Task', note: 'Note', ignore: 'Ignore' }
const kindLabel = (kind: string) => t(KIND_LABEL[kind] || kind)
const typeOptions = () => TYPES.map((value: ItemType) => ({ value, text: kindLabel(value) }))
const ASK_FOR: Record<Role, string> = {
  pm: 'This change is for the product manager.',
  techlead: 'This change is for the tech lead.',
  both: 'This change is for everyone.',
}
const SET_BY: Record<Role, string> = { pm: 'set by the product manager', techlead: 'set by the tech lead', both: 'set by everyone' }
const roleOptions = () => [
  { value: 'pm', text: t('Product manager') },
  { value: 'techlead', text: t('Tech lead') },
  { value: 'both', text: t('Everyone') },
]
const TAB_NAMES = ['Map', 'Differences', 'Reading', 'GitHub']
const DRIFT_LABEL: Record<Drift['kind'], string> = { dropped: 'Dropped on GitHub', schedule: 'Planned too late', milestone: 'Milestone', parent: 'Parent', title: 'Title' }
const LANG_OPTIONS: Array<{ value: LangSetting; text: string }> = [
  { value: 'auto', text: 'Automatic' },
  { value: 'en', text: 'English' },
  { value: 'fr', text: 'Français' },
]
// A sticky colour's name, for "3 yellow stickies".
const HUES = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'violet', 'pink', 'white', 'gray']
const hueName = (hue: string) => (HUES.includes(hue) ? t(hue) : hue)

// Until the plugin code says which language to show, the system's.
setLang(resolveLang('auto', navigator.language))

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

// "1 epic, 2 features, 3 tasks".
const counts = (stats: { epics: number; features: number; tasks: number }) => [
  plural(stats.epics, '{n} epic', '{n} epics'),
  plural(stats.features, '{n} feature', '{n} features'),
  plural(stats.tasks, '{n} task', '{n} tasks'),
]

// "just now", "3 min ago", "2 h ago".
function ago(time: number, now: number) {
  const minutes = Math.floor((now - time) / 60000)
  if (minutes < 1) return t('just now')
  if (minutes < 60) return t('{n} min ago', { n: minutes })
  return t('{n} h ago', { n: Math.floor(minutes / 60) })
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
      title: t('Check how the board is read'),
      done: board.guide.readingConfirmed,
      body: (
        <Fragment>
          <p class={styles.help}>
            {t(b.mode === 'rows' ? "Read by rows, as in Figma's story map template: {counts}" : 'Read by sticky colours: {counts}', { counts: counts(b.stats).join(', ') })}
            {b.milestones.length ? t(', releases {list}.', { list: b.milestones.join(', ') }) : t(', no releases.')}
          </p>
          <div class={styles.actions}>
            <Button onClick={() => emit<SetGuideHandler>('SET_GUIDE', { readingConfirmed: true })}>{t("That's right")}</Button>
            <Button secondary onClick={() => props.goTo('Reading')}>{t('Adjust')}</Button>
          </div>
        </Fragment>
      ),
    },
    {
      title: t('Connect GitHub'),
      done: connected,
      body: connected ? (
        <p class={styles.help}>
          {board.readAt
            ? t('Connected to {repo}, updated {ago}.', { repo: board.settings.repo, ago: ago(board.readAt, props.now) })
            : t('Connected to {repo}.', { repo: board.settings.repo })}
        </p>
      ) : (
        <Fragment>
          <p class={styles.help}>{t("Name the repository where the team's issues live. The plugin reads them again every time it opens.")}</p>
          <div class={styles.actions}><Button onClick={() => props.goTo('GitHub')}>{t('Connect')}</Button></div>
        </Fragment>
      ),
    },
    {
      title: t('Link your stickies to their issues'),
      done: connected && progress.linked > 0,
      body: (
        <p class={styles.help}>
          {connected ? `${t('{n} of {total} linked.', { n: progress.linked, total: progress.total })} ` : ''}
          {t('Click a sticky on the board: its card shows the issues it most likely is.')}
        </p>
      ),
    },
    {
      title: t('Show labels on the board'),
      done: board.labelsOn,
      body: connected ? (
        <Toggle value={board.labelsOn} onValueChange={(v: boolean) => emit<SetLabelsHandler>('SET_LABELS', v)}>{t('Labels on the board')}</Toggle>
      ) : (
        <p class={styles.help}>{t('Once connected, each linked sticky can show its issue number, sprint and status.')}</p>
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
        <span class={styles.guideCount}>{t('Get started · {n} of {total}', { n: current + 1, total: steps.length })}</span>
        <span class={styles.guideDots}>
          {steps.map((s, i) => <span key={s.title} class={`${styles.guideDot} ${s.done ? styles.guideDotDone : i === current ? styles.guideDotNow : ''}`} />)}
        </span>
        <IconButton onClick={() => emit<SetGuideHandler>('SET_GUIDE', { hidden: true })} title={t('Hide the guide')}>
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
      title={t('{tip}. Click to change.', { tip })}
      onClick={(e) => {
        e.stopPropagation()
        props.onOpen()
      }}
    >
      {text}
    </button>
  )
  if (m.status === 'linked') return pill(styles.pillExists, `#${m.number}`, t('Linked to: {title}', { title: m.title }))
  if (m.status === 'exists') return pill(styles.pillExists, `#${m.number}`, t('Same title as: {title}', { title: m.title }))
  if (m.status === 'maybe') return pill(styles.pillMaybe, `#${m.number}?`, t('Close to: {title}', { title: m.title }))
  // "New" on a sticky with no issue yet: not the same word in French as a new issue.
  return pill(styles.pillNew, t('New', undefined, 'sticky'), m.confirmed ? t('Marked as not on GitHub yet') : t('No issue with a close title'))
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
  // The batch to publish: ticked stickies, by id; unset means the default.
  const [picked, setPicked] = useState<Record<string, boolean>>({})
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({ drifts: true, week: true })
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
        // The language first, so this render already shows it.
        setLang(next.settings.lang)
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
    emit<ReadyHandler>('READY', navigator.language)
    return () => offs.forEach((off) => off())
  }, [])

  if (!board) return <div class={styles.empty}>{t('Reading the board…')}</div>

  const b = board.backlog
  // Whether this person's role makes this change; if not, who to ask.
  const may = (action: Action) => canDo(board.settings.role, action, board.settings.owners)
  const askFor = (action: Action) => <span class={styles.help}>{t(ASK_FOR[board.settings.owners[action]])}</span>
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
    const tip = issue ? [issue.status, issue.size && t('size {size}', { size: issue.size }), issue.assignees.length ? `@${issue.assignees.join(', @')}` : ''].filter(Boolean).join(', ') : ''
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
        <span class={`${styles.dot} ${styles[kind]}`} title={kindLabel(kind)} />
        <span class={`${styles.label} ${kind === 'epic' ? styles.labelStrong : ''}`} title={t('{kind}: {title}', { kind: kindLabel(kind), title: item.title })}>
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
        {f.steps.length ? <div class={styles.steps}>{t('Steps: {list}', { list: f.steps.map((s) => s.title).join(' · ') })}</div> : null}
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
            <span class={styles.cardTitle}>{t('Not part of the map')}</span>
            <button class={styles.close} onClick={() => setSelected(null)} aria-label={t('Close')}>✕</button>
          </div>
          <p class={styles.help}>{t('This node is a label, a legend sticky, or a colour or row the map ignores. Change that in Reading.')}</p>
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
          <button class={styles.close} onClick={() => setSelected(null)} aria-label={t('Close')}>✕</button>
        </div>
        <div class={styles.cardMeta}>
          {parent ? t('{kind} in {parent}', { kind: kindLabel(kind), parent }) : kindLabel(kind)}
          {item.release ? ` · ${item.release}` : ''}
        </div>
        {!canLink ? <p class={styles.help}>{kind === 'step' ? t('Steps are written in their feature, not as issues.') : t('Notes stay on the board, not on GitHub.')}</p> : null}
        {canLink && board.settings.issuesLoaded === null ? (
          <p class={styles.help}>
            {t('Connect a repository in')} <button class={styles.linkButton} onClick={() => setTab('GitHub')}>GitHub</button> {t("to see this sticky's issue.")}
          </p>
        ) : null}
        {canLink && issue ? (
          <div class={styles.cardIssue}>
            <button class={styles.linkButton} onClick={() => issue.url && emit<OpenHandler>('OPEN', issue.url)}>
              #{issue.number} {issue.title}
            </button>
            <div class={styles.cardMeta}>
              {[
                issue.state === 'closed' ? t('Closed') : issue.status || t('Open'),
                issue.sprint,
                issue.size && t('size {size}', { size: issue.size }),
                issue.assignees.length ? `@${issue.assignees.join(', @')}` : t('no one assigned'),
              ]
                .filter(Boolean)
                .join(' · ')}
            </div>
            {board.settings.sizeOptions ? (
              <div class={styles.sizeRow}>
                <span class={styles.fieldLabel}>{t('Size')}</span>
                {board.settings.writeAllowed && may('size') ? (
                  <SegmentedControl
                    value={issue.size || 'none'}
                    options={[{ value: 'none', children: t('None', undefined, 'size') }, ...board.settings.sizeOptions.map((o) => ({ value: o, children: o }))]}
                    onValueChange={(v: string) => {
                      setPublishedFrom(item.id)
                      emit<SetSizeHandler>('SET_SIZE', issue.number, v === 'none' ? null : v)
                    }}
                  />
                ) : (
                  <span>
                    {issue.size || t('No size')}
                    {board.settings.writeAllowed ? <span class={styles.help}> · {t(SET_BY[board.settings.owners.size])}</span> : null}
                  </span>
                )}
              </div>
            ) : null}
            <div class={styles.actions}>
              <Button secondary onClick={() => linkTo(0)}>{t('Not this issue')}</Button>
            </div>
          </div>
        ) : null}
        {canLink && !issue && board.issues.length ? (
          <Fragment>
            <p class={styles.question}>{m && m.confirmed ? t('Marked as not on GitHub yet.') : t('Already on GitHub? Pick its issue')}</p>
            {candidates.map((c) => (
              <button key={c.number} class={styles.candidate} onClick={() => linkTo(c.number)}>
                #{c.number} {c.title}
                <span class={styles.candidateWhy}>{c.score > 1 ? t('Same title') : t('Words in common: {words}', { words: sharedWords(c.title, c.shared) })}</span>
              </button>
            ))}
            {!candidates.length ? <p class={styles.help}>{t('No issue has a close title.')}</p> : null}
            <SearchTextbox value={search} onValueInput={setSearch} placeholder={t('Search another issue')} />
            {searched.map((i) => (
              <button key={i.number} class={styles.candidate} onClick={() => linkTo(i.number)}>
                #{i.number} {i.title}
              </button>
            ))}
            <div class={styles.actions}>
              {!(m && m.confirmed) ? <Button secondary onClick={() => linkTo(0)}>{t('None of these')}</Button> : null}
              {m && (m.status === 'linked' || m.confirmed) ? <Button secondary onClick={() => linkTo(null)}>{t('Guess from the title')}</Button> : null}
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
    const { meta, publishing, writeAllowed, repo: repoName, project: projectUrl, statusOptions } = board.settings
    if (!meta) return null
    const draft = draftIssue(id, b, board.matches, meta, publishing)
    if (!draft) return null
    const busy = status !== null && status.state === 'loading'
    const title = draftTitle || draft.title
    const text = draftBody || draft.body
    const lines: Array<[string, string]> = [
      [t('Type'), draft.type ? draft.type : t('label "{label}" (no {type} type here)', { label: draft.kind, type: KIND_LABEL[draft.kind] })],
      [
        t('Parent'),
        draft.parent ? (draft.parent.number ? `#${draft.parent.number} ${draft.parent.title}` : t('{title}, not on GitHub yet', { title: draft.parent.title })) : t('None'),
      ],
      [t('Milestone'), draft.milestone ? draft.milestone.title : t('None')],
      [t('Labels'), draft.labels.length ? draft.labels.join(', ') : t('None')],
    ]
    // No starting status set: the issue goes to the board's first status.
    const firstStatus = statusOptions && statusOptions.length ? statusOptions[0] : null
    if (projectUrl) lines.push([t('On the board'), draft.status || firstStatus || t('Added, without status')])
    return (
      <div class={styles.publish}>
        <p class={styles.question}>{t('Not yet? Create its issue in {repo}', { repo: repoName })}</p>
        <span class={styles.fieldLabel}>{t('Title')}</span>
        <Textbox value={title} onValueInput={setDraftTitle} spellCheck={false} />
        <span class={styles.fieldLabel} style={{ marginTop: 8 }}>{t('Story and acceptance criteria')}</span>
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
        {writeAllowed && !may('create') ? (
          askFor('create')
        ) : writeAllowed ? (
          <div class={styles.actions}>
            <Button
              disabled={busy || !title.trim()}
              onClick={() => {
                setPublishedFrom(id)
                emit<PublishHandler>('PUBLISH', id, title, text)
              }}
            >
              {t('Create the issue')}
            </Button>
          </div>
        ) : (
          <p class={styles.help}>
            {t('Changes to {repo} are off. Allow them in', { repo: repoName })} <button class={styles.linkButton} onClick={() => setTab('GitHub')}>GitHub</button>{' '}
            {t('to publish from here.')}
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
          <p><b>{t('No story map on this page')}</b></p>
          <p>
            {t(
              "Start one from a template, laid out like Figma's story map: a row for the persona, the activities, the tasks and two releases. Or open the page that holds your map; check Reading if it uses other colours or rows.",
            )}
          </p>
          <div class={styles.actions} style={{ justifyContent: 'center' }}>
            <Button onClick={() => emit<AddTemplateHandler>('ADD_TEMPLATE')}>{t('Add a story map template')}</Button>
          </div>
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
            <span>{counts(b.stats).join(' · ')}</span>
            {board.issues.length ? (
              <span class={styles.inlineToggle} title={t("Show each linked sticky's issue, sprint and status on the board")}>
                <Toggle value={board.labelsOn} onValueChange={(v: boolean) => emit<SetLabelsHandler>('SET_LABELS', v)}>
                  {t('Labels', undefined, 'board')}
                </Toggle>
              </span>
            ) : null}
          </div>
          {board.settings.issuesLoaded !== null ? (
            <div class={styles.progress} title={t('{n} of {total} stickies linked to an issue', { n: progress.linked, total: progress.total })}>
              <div class={styles.progressBar} style={{ width: `${progress.total ? Math.round((progress.linked / progress.total) * 100) : 0}%` }} />
              <span class={styles.progressText}>{t('{n} of {total} linked to GitHub', { n: progress.linked, total: progress.total })}</span>
            </div>
          ) : null}
          {b.milestones.length || board.sprints.length ? (
            <div class={styles.filters}>
              {b.milestones.length ? (
                <Dropdown
                  value={releases.includes(filter) ? filter : 'all'}
                  options={releases.map((r) => ({ value: r, text: r === 'all' ? t('All releases') : r === 'none' ? t('No release') : r }))}
                  onValueChange={setFilter}
                />
              ) : null}
              {board.sprints.length ? (
                <Dropdown
                  value={sprintFilter === 'none' || board.sprints.some((x) => x.title === sprintFilter) ? sprintFilter : 'all'}
                  options={[
                    { value: 'all', text: t('All sprints') },
                    ...board.sprints.map((x) => ({ value: x.title, text: t('{sprint} · ends {date}', { sprint: x.title, date: x.end.slice(5) }) })),
                    { value: 'none', text: t('Not in a sprint') },
                  ]}
                  onValueChange={setSprintFilter}
                />
              ) : null}
            </div>
          ) : null}
          <div class={styles.kinds}>
            {(['epic', 'feature', 'task'] as Array<Kind>).map((k) => (
              <span key={k}><span class={`${styles.dot} ${styles[k]}`} /> {kindLabel(k)}</span>
            ))}
            {b.notes.length ? <span><span class={`${styles.dot} ${styles.note}`} /> {kindLabel('note')}</span> : null}
          </div>
        </div>
        {b.unmapped.length ? (
          <div class={`${styles.notice} ${styles.warn}`}>
            {plural(b.unmapped.length, '{n} colour not read yet. Set it in', '{n} colours not read yet. Set them in')}{' '}
            <button class={styles.linkButton} onClick={() => setTab('Reading')}>{t('Reading')}</button>.
          </div>
        ) : null}
        {b.orphans.length ? (
          <div class={`${styles.notice} ${styles.warn}`}>
            {plural(b.orphans.length, '{n} item has no parent column. It is listed at the bottom.', '{n} items have no parent column. They are listed at the bottom.')}
          </div>
        ) : null}
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
            <p class={styles.sectionTitle}>{t('Notes, not issues')}</p>
            <ul class={styles.tree}>{b.notes.map((n) => <li key={n.id}>{row(n, 'note')}</li>)}</ul>
          </Fragment>
        ) : null}
        {b.orphans.length ? (
          <Fragment>
            <p class={styles.sectionTitle}>{t('Without a parent')}</p>
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
      title: t('Rename the issue'),
      milestone: x.target ? t('Set milestone {m}', { m: String(x.target) }) : t('Remove the milestone'),
      parent: t('Move under #{n}', { n: String(x.target) }),
    }
    const canFix = x.kind in mapLabel
    const action = (x.kind === 'parent' ? 'parent' : x.kind === 'milestone' ? 'milestone' : 'title') as Action
    return (
      <div class={styles.settle}>
        {canFix && !may(action) ? (
          askFor(action)
        ) : canFix ? (
          board.settings.writeAllowed ? (
            <Button onClick={() => go('map')} title={t('The map is right: change GitHub')}>
              {mapLabel[x.kind]}
            </Button>
          ) : (
            <span class={styles.help}>{t('To change GitHub from here, choose Can write in GitHub.')}</span>
          )
        ) : null}
        {x.kind === 'title' && may('title') ? (
          <Button secondary onClick={() => go('github')} title={t('GitHub is right: change the sticky')}>
            {t('Rename the sticky')}
          </Button>
        ) : null}
        <Button secondary onClick={() => go('keep')} title={t('Both are right: stop showing this difference')}>
          {t('Keep both')}
        </Button>
      </div>
    )
  }

  // Publishing a batch: every sticky with no issue, to tick one by one or
  // all at once, except those that look like an issue that already exists.
  const batch = (items: Array<{ id: string; title: string; kind: string }>) => {
    const s = board.settings
    const publishable = items.filter((i) => i.kind === 'epic' || i.kind === 'feature' || i.kind === 'task')
    const lookalike = (i: { title: string; kind: string }) => {
      const best = suggestIssues(i.title, i.kind, board.issues.map((x) => ({ number: x.number, title: x.title })), 1)[0]
      return best && best.score >= 0.3 ? best : null
    }
    // Nothing is ticked at first: an issue is hard to take back.
    const ticked = (i: { id: string; title: string; kind: string }) => Boolean(picked[i.id])
    const chosen = publishable.filter(ticked)
    const busy = status !== null && status.state === 'loading'
    const row = (i: { id: string; title: string; kind: string }) => {
      const like = lookalike(i)
      return (
        <div class={styles.row} key={i.id} onMouseEnter={() => focus(i.id, false)}>
          <span class={`${styles.dot} ${styles[i.kind as Kind] || ''}`} title={kindLabel(i.kind)} />
          {s.writeAllowed && may('create') && publishable.includes(i) ? (
            <span class={styles.label}>
              <Checkbox value={ticked(i)} onValueChange={(v: boolean) => setPicked((p) => ({ ...p, [i.id]: v }))}>
                {i.title}
              </Checkbox>
            </span>
          ) : (
            <button class={`${styles.rowLink} ${styles.label}`} onClick={() => open(i.id)}>{i.title}</button>
          )}
          {like ? (
            <button class={`${styles.pill} ${styles.pillMaybe}`} title={t('Looks like #{n} {title}. Open the card to link it.', { n: like.number, title: like.title })} onClick={() => open(i.id)}>
              #{like.number}?
            </button>
          ) : null}
        </div>
      )
    }
    if (!s.writeAllowed || !may('create')) {
      return (
        <Fragment>
          {s.writeAllowed ? <p>{askFor('create')}</p> : <p class={styles.help}>{t('To create these as issues in one go, choose Can write in GitHub.')}</p>}
          {items.map(row)}
        </Fragment>
      )
    }
    return (
      <Fragment>
        <p class={styles.help}>
          {t(
            "Tick the stickies to create as issues: they are created parents first, each with the repository's issue text. The ones marked #? look like an issue that exists: open their card to link them instead.",
          )}
        </p>
        <div class={styles.actions} style={{ marginBottom: 6 }}>
          <Button
            disabled={busy || !chosen.length}
            onClick={() => {
              setResolving('batch')
              emit<PublishManyHandler>('PUBLISH_MANY', chosen.map((i) => i.id))
              setPicked({})
            }}
          >
            {plural(chosen.length, 'Create {n} issue', 'Create {n} issues')}
          </Button>
          <Button secondary onClick={() => setPicked(Object.fromEntries(publishable.map((i) => [i.id, !lookalike(i)])))} title={t('Ticks every sticky that looks like no existing issue')}>
            {t('Tick the new ones')}
          </Button>
          <Button secondary onClick={() => setPicked(Object.fromEntries(publishable.map((i) => [i.id, false])))}>{t('Tick none')}</Button>
        </div>
        {items.map(row)}
      </Fragment>
    )
  }

  // What moved since the team started the week: new, closed and changed
  // issues, with each field before and after, for the weekly.
  const KIND_MOVED: Record<string, string> = { new: 'New', closed: 'Closed', reopened: 'Reopened', changed: 'Changed' }
  const week = () => {
    const w = board.week
    const start = () => {
      setResolving('week')
      emit<StartWeekHandler>('START_WEEK')
    }
    if (!w) {
      return (
        <div class={styles.weekStart}>
          <p class={styles.question}>{t('What moved this week?')}</p>
          <p class={styles.help}>
            {t('Mark the start of the week, at the weekly for example: from then on, the issues that are created, closed or change status, sprint, size or title show here, for the whole team.')}
          </p>
          <div class={styles.actions}><Button secondary onClick={start}>{t('Start the week now')}</Button></div>
        </div>
      )
    }
    const since = new Date(w.at).toLocaleString(getLang(), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    const stickyOf = (number: number) => Object.keys(board.matches).find((id) => issueOf(board, id) && issueOf(board, id)!.number === number)
    return (
      <Disclosure
        open={Boolean(openSections.week)}
        onClick={() => toggleSection('week')}
        title={`${t('Since {date}', { date: since })} · ${w.moved.length ? plural(w.moved.length, '{n} issue moved', '{n} issues moved') : t('nothing moved')}`}
      >
        {w.moved.map((m) => {
          const sticky = stickyOf(m.number)
          const url = board.issues.find((i) => i.number === m.number)?.url
          return (
            <div class={styles.moved} key={m.number}>
              <div class={styles.driftHead}>
                <span class={`${styles.pill} ${m.kind === 'new' ? styles.pillNew : m.kind === 'changed' ? styles.pillMilestone : styles.pillMaybe}`}>{t(KIND_MOVED[m.kind])}</span>
                <button
                  class={`${styles.linkButton} ${styles.label}`}
                  onClick={() => (sticky ? open(sticky) : url && emit<OpenHandler>('OPEN', url))}
                  title={sticky ? t('Show its sticky') : t('Not on the map: open on GitHub')}
                >
                  #{m.number} {m.title}
                </button>
              </div>
              {m.changes.map((c) => (
                <div class={styles.movedChange} key={c.field}>
                  <span class={styles.driftSide}>{c.field}</span>
                  <span>{c.from} → {c.to}</span>
                </div>
              ))}
            </div>
          )
        })}
        <div class={styles.actions}>
          <Button secondary onClick={start} title={t('Compare against this moment from now on')}>{t('Start a new week')}</Button>
        </div>
      </Disclosure>
    )
  }

  const toggleSection = (key: string) => setOpenSections((o) => ({ ...o, [key]: !o[key] }))

  const drift = () => {
    const d = board.drift
    if (!d) {
      return (
        <div class={styles.empty}>
          <p><b>{t('Connect a repository first')}</b></p>
          <p>
            {t('In')} <button class={styles.linkButton} onClick={() => setTab('GitHub')}>GitHub</button>
            {t(', sign in and pick the repository of this map.')}
          </p>
        </div>
      )
    }
    return (
      <Fragment>
        {resolving && status ? <div class={`${styles.notice} ${styles[status.state === 'loading' ? 'info' : status.state]}`} role="status">{status.text}</div> : null}
        {week()}
        {d.drifts.length ? (
          <p class={styles.lead}>
            {plural(
              d.drifts.length,
              'One place where the map and GitHub disagree. Pick which side is right; nothing changes until you do.',
              '{n} places where the map and GitHub disagree. Pick which side is right; nothing changes until you do.',
            )}
          </p>
        ) : (
          <div class={`${styles.notice} ${styles.ok}`}>{t('The linked stickies and their issues agree.')}</div>
        )}
        {d.drifts.map((x) => {
          const key = `${x.id}:${x.kind}:${x.number}`
          const w = why[key]
          return (
            <div class={styles.drift} key={key}>
              <div class={styles.driftHead}>
                <span class={`${styles.pill} ${styles.pillMaybe}`}>{t(DRIFT_LABEL[x.kind])}</span>
                <button class={`${styles.linkButton} ${styles.label}`} onClick={() => open(x.id)}>{x.title}</button>
                <button class={styles.linkButton} onClick={() => x.url && emit<OpenHandler>('OPEN', x.url)}>#{x.number}</button>
              </div>
              <div class={styles.driftSides}>
                <span class={styles.driftSide}>{t('Map')}</span><span>{x.board}</span>
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
                  {t('Why?')}
                </Button>
              ) : w.loading ? (
                <p class={styles.help}>{t('Reading the history…')}</p>
              ) : w.error ? (
                <p class={styles.help}>{w.error}</p>
              ) : w.lines && w.lines.length ? (
                <ul class={styles.history}>{w.lines.map((l) => <li key={l}>{l}</li>)}</ul>
              ) : (
                <p class={styles.help}>{t('No change recorded on GitHub: it has differed since the issue was written.')}</p>
              )}
            </div>
          )
        })}
        {d.toConfirm.length ? (
          <Disclosure open={Boolean(openSections.confirm)} onClick={() => toggleSection('confirm')} title={`${t('Close titles to confirm')} · ${d.toConfirm.length}`}>
            {d.toConfirm.map((i) => (
              <div class={styles.row} key={i.id} onClick={() => open(i.id)} onMouseEnter={() => focus(i.id, false)}>
                <span class={`${styles.dot} ${styles[i.kind as Kind] || ''}`} title={kindLabel(i.kind)} />
                <span class={styles.label}>{i.title}</span>
                <span class={`${styles.pill} ${styles.pillMaybe}`}>#{i.number}?</span>
              </div>
            ))}
          </Disclosure>
        ) : null}
        {d.onlyOnBoard.length ? (
          <Disclosure open={Boolean(openSections.board)} onClick={() => toggleSection('board')} title={`${t('On the map only')} · ${d.onlyOnBoard.length}`}>
            {batch(d.onlyOnBoard)}
          </Disclosure>
        ) : null}
        {d.onlyOnGitHub.length ? (
          <Disclosure open={Boolean(openSections.github)} onClick={() => toggleSection('github')} title={`${t('On GitHub only')} · ${plural(d.onlyOnGitHub.length, '{n} open issue', '{n} open issues')}`}>
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
    // Figma's node types, such as "12 sticky, 3 text"; the usual ones are translated.
    const types = Object.entries(board.nodeTypes)
      .sort((x, y) => y[1] - x[1])
      .map(([type, c]) => `${c} ${t(type.toLowerCase().replace(/_/g, ' '), undefined, 'node')}`)
      .join(', ')
    return (
      <Fragment>
        <div style={{ margin: '12px 0 8px' }}>
          <SegmentedControl
            value={board.settings.mode}
            onValueChange={(v: string) => emit<SetModeHandler>('SET_MODE', v as BoardPayload['settings']['mode'])}
            options={[{ value: 'auto', children: t('Automatic') }, { value: 'rows', children: t('By rows') }, { value: 'colours', children: t('By colours') }]}
          />
        </div>
        <p class={styles.help}>
          {byRows
            ? t("Read by rows, as in Figma's story map template: each labelled row gives the kind of the stickies in it. Release rows become milestones.")
            : t('Read by colours: each sticky colour gives one kind of item.')}
          {board.settings.mode === 'auto' ? ` ${t('Chosen automatically.')}` : ''}
        </p>
        {byRows
          ? b.rows.map((r) => (
              <div class={styles.legendRow} key={r.name}>
                <span class={`${styles.swatch} ${styles.rowMark}`}>{r.kind === 'release' ? 'R' : r.name.slice(0, 1).toUpperCase()}</span>
                <div>
                  <div>{r.name}</div>
                  <div class={styles.samples}>
                    {plural(r.count, '{n} sticky', '{n} stickies')}
                    {r.kind === 'release' ? t(', milestone') : ''}
                  </div>
                </div>
                <Dropdown value={r.type} options={typeOptions()} onValueChange={(v: string) => emit<SetRowTypeHandler>('SET_ROW_TYPE', r.name, v as ItemType)} />
              </div>
            ))
          : board.palette.map((c) => (
              <div class={styles.legendRow} key={c.hex}>
                <span class={styles.swatch} style={{ background: c.hex }} />
                <div>
                  <div>{plural(c.count, '{n} {hue} sticky', '{n} {hue} stickies', { hue: hueName(c.hue) })}</div>
                  <div class={styles.samples} title={c.samples.join(' · ')}>{c.samples.join(' · ')}</div>
                </div>
                <Dropdown value={board.legend[c.hex] || 'ignore'} options={typeOptions()} onValueChange={(v: string) => emit<SetLegendHandler>('SET_LEGEND', c.hex, v as ItemType)} />
              </div>
            ))}
        <p class={styles.help}>
          {t('Read on this page: {types}.', { types: types || t('nothing') })}{' '}
          {plural(b.stats.ignored, '{n} sticky skipped (legend, labels, empty or ignored).', '{n} stickies skipped (legend, labels, empty or ignored).')}
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
          <span class={styles.stepTitle}>{t('1. Your GitHub account')}</span>
          {auth.state === 'error' ? <div class={`${styles.notice} ${styles.error}`}>{auth.error}</div> : null}
          {signedIn ? (
            <div class={styles.stepRow}>
              <span>{t('Connected as')} <strong>@{s.login}</strong></span>
              <Button secondary onClick={() => emit<ForgetTokenHandler>('FORGET_TOKEN')}>{t('Sign out')}</Button>
            </div>
          ) : null}
          {signedIn ? (
            <p class={styles.help}>
              {t('The plugin can read and change issues in the repositories your account can reach; it only writes where you choose "Can write". Signing out forgets the token here; revoke it on')}{' '}
              <button class={styles.linkButton} onClick={() => emit<OpenHandler>('OPEN', 'https://github.com/settings/applications')}>GitHub</button>.
            </p>
          ) : auth.state === 'code' ? (
            <Fragment>
              <p class={styles.help}>{t('Enter this code on GitHub, then authorize Storymap to GitHub.')}</p>
              <div class={styles.userCode}>{auth.userCode}</div>
              <div class={styles.actions}>
                <Button
                  onClick={() => {
                    setCodeCopied(copyText(auth.userCode || ''))
                    if (auth.url) emit<OpenHandler>('OPEN', auth.url)
                  }}
                >
                  {codeCopied ? t('Code copied, opening GitHub') : t('Copy the code and open GitHub')}
                </Button>
                <Button secondary onClick={() => emit<CancelSignInHandler>('CANCEL_SIGN_IN')}>{t('Cancel')}</Button>
              </div>
              <p class={styles.help}>{t('Waiting for GitHub…')}</p>
            </Fragment>
          ) : s.hasToken ? (
            <div class={styles.stepRow}>
              <span>{t('Connected with a token')}</span>
              <Button secondary onClick={() => emit<ForgetTokenHandler>('FORGET_TOKEN')}>{t('Forget it')}</Button>
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
                  {t('Connect with GitHub')}
                </Button>
              </div>
              {useToken ? (
                <div class={styles.field}>
                  <span class={styles.fieldLabel}>{t('Or paste a token (classic: repo, project, read:org)')}</span>
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
                      {t('Use this token')}
                    </Button>
                  </div>
                </div>
              ) : (
                <p class={styles.help}>
                  {t('Opens GitHub to approve, nothing to copy by hand.')}{' '}
                  <button class={styles.linkButton} onClick={() => setUseToken(true)}>{t('Use a token instead')}</button>
                </p>
              )}
            </Fragment>
          )}
        </div>

        {s.hasToken ? (
          <div class={styles.setupStep}>
            <span class={styles.stepTitle}>{t('2. Repository')}</span>
            {s.repo && !changingRepo ? (
              <div class={styles.stepRow}>
                <strong>{s.repo}</strong>
                <Button secondary onClick={() => setChangingRepo(true)}>{t('Change')}</Button>
              </div>
            ) : (
              <Fragment>
                <SearchTextbox value={repoSearch} onValueInput={setRepoSearch} placeholder={repos ? plural(repos.length, 'Search {n} repository', 'Search {n} repositories') : t('Loading your repositories…')} />
                {shown.map((r) => (
                  <button key={r.name} class={styles.candidate} onClick={() => pickRepo(r.name)}>
                    {r.name}
                    {r.private ? <span class={styles.candidateWhy}>{t('Private')}</span> : null}
                  </button>
                ))}
                {typed ? <button class={styles.candidate} onClick={() => pickRepo(repoSearch.trim())}>{t('Use {repo}', { repo: repoSearch.trim() })}</button> : null}
                {s.repo ? <Button secondary onClick={() => setChangingRepo(false)}>{t('Keep {repo}', { repo: s.repo })}</Button> : null}
              </Fragment>
            )}
          </div>
        ) : null}

        {s.hasToken && s.repo && !changingRepo ? (
          <div class={styles.setupStep}>
            <span class={styles.stepTitle}>{t('3. Project board, for sprints and status')}</span>
            {projects === null ? (
              <p class={styles.help}>{t('Looking for the boards of {repo}…', { repo: s.repo })}</p>
            ) : (
              <Dropdown
                value={projects.some((p) => p.url === s.project) ? s.project : 'none'}
                options={[{ value: 'none', text: projects.length ? t('No board') : t('This repository has no board') }, ...projects.map((p) => ({ value: p.url, text: p.title }))]}
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
        <span class={styles.stepTitle}>{t('4. Your role')}</span>
        <SegmentedControl
          value={board.settings.role}
          options={roleOptions().map((o) => ({ value: o.value, children: o.text }))}
          onValueChange={(v: string) => emit<SetRoleHandler>('SET_ROLE', v as Role)}
        />
        <p class={styles.help}>{t("The plugin only offers the changes of your role, so nobody changes someone else's field by mistake. Who does what is under More settings.")}</p>
        <span class={styles.stepTitle} style={{ marginTop: 12 }}>{t('5. What the plugin may do in {repo}', { repo: repoName })}</span>
        <SegmentedControl
          value={writeAllowed ? 'write' : 'read'}
          options={[{ value: 'read', children: t('Read only') }, { value: 'write', children: t('Can write') }]}
          onValueChange={(v: string) => emit<SetWriteHandler>('SET_WRITE', v === 'write')}
        />
        <p class={styles.help}>
          {writeAllowed
            ? t('The plugin can create issues, set sizes and settle differences, each after you click, and only the changes of your role.')
            : t('The plugin only reads GitHub. This is the default for every repository.')}
        </p>
        {meta && !meta.canPush ? <div class={`${styles.notice} ${styles.warn}`}>{t('Your account cannot write to {repo}: creating issues will fail.', { repo: repoName })}</div> : null}
        <details class={styles.more}>
          <summary>{t('More settings')}</summary>
          <div class={styles.field}>
            <span class={styles.fieldLabel}>{t('Language')}</span>
            <SegmentedControl
              value={board.settings.langSetting}
              options={LANG_OPTIONS.map((o) => ({ value: o.value, children: o.value === 'auto' ? t(o.text) : o.text }))}
              onValueChange={(v: string) => emit<SetLangHandler>('SET_LANG', v as LangSetting)}
            />
          </div>
          <span class={styles.fieldLabel}>{t('Who does what, for the whole team')}</span>
          {(Object.keys(ACTIONS) as Array<Action>).map((a) => (
            <div class={styles.ownerRow} key={a}>
              <span>{t(ACTIONS[a])}</span>
              <Dropdown value={board.settings.owners[a]} options={roleOptions()} onValueChange={(v: string) => emit<SetOwnerHandler>('SET_OWNER', a, v as Role)} />
            </div>
          ))}
        <div class={styles.field}>
          <span class={styles.fieldLabel}>{t('Label of a new issue (empty for none)')}</span>
          <Textbox
            value={startLabel === null ? publishing.startLabel : startLabel}
            onValueInput={setStartLabel}
            onBlur={() => startLabel !== null && save({ startLabel: startLabel.trim() })}
            spellCheck={false}
          />
        </div>
        <div class={styles.field}>
          <span class={styles.fieldLabel}>{t("Status of a new issue on the project board (empty: the board's first status)")}</span>
          <Textbox
            value={startStatus === null ? publishing.startStatus : startStatus}
            onValueInput={setStartStatus}
            onBlur={() => startStatus !== null && save({ startStatus: startStatus.trim() })}
            spellCheck={false}
          />
        </div>
        <div class={styles.field}>
          <span class={styles.fieldLabel}>{t('Text of a new issue. {title}, {parent}, {release} and {steps} are filled in.')}</span>
          <TextboxMultiline
            value={bodyTemplate === null ? publishing.bodyTemplate || defaultBody() : bodyTemplate}
            onValueInput={setBodyTemplate}
            onBlur={() => bodyTemplate !== null && save({ bodyTemplate: bodyTemplate.trim() === defaultBody() ? '' : bodyTemplate })}
            rows={8}
            grow
          />
          {publishing.bodyTemplate ? (
            <button class={styles.linkButton} onClick={() => { setBodyTemplate(null); save({ bodyTemplate: '' }) }}>{t('Back to the default text')}</button>
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
              <button class={styles.headerLink} onClick={() => setTab('GitHub')} title={t('Change the repository')}>
                {board.settings.repo}
              </button>
            ) : (
              <button class={styles.headerLink} onClick={() => setTab('GitHub')}>{t('Connect GitHub')}</button>
            )}
          </div>
          <div class={styles.scope}>
            {/^page\b/i.test(board.page) ? board.page : t('Page {name}', { name: board.page })}
            {board.settings.issuesLoaded !== null ? ` · ${plural(board.settings.issuesLoaded, '{n} issue', '{n} issues')}` : ''}
            {board.readAt ? ` · ${t('updated {ago}', { ago: ago(board.readAt, now) })}` : ''}
          </div>
        </div>
        {board.guide.hidden ? <Button secondary onClick={() => { emit<SetGuideHandler>('SET_GUIDE', { hidden: false }); setTab('Map') }}>{t('Guide')}</Button> : null}
        <IconButton onClick={() => emit<RefreshHandler>('REFRESH')} title={t('Read the board and GitHub again')}>
          <IconRefresh16 />
        </IconButton>
      </div>
      {/* Tabs show their value, so the value is the translated name; the state keeps the English one. */}
      <Tabs
        value={t(tab)}
        onValueChange={(v: string) => setTab(TAB_NAMES.find((name) => t(name) === v) || 'Map')}
        options={TAB_NAMES.map((name) => ({ value: t(name), children: null }))}
      />
      <div class={styles.main}>{tabContent[tab]()}</div>
      <div class={styles.footer}>
        <button class={styles.mode} onClick={() => setTab('GitHub')} title={t('What the plugin may do on GitHub')}>
          {board.settings.writeAllowed ? <IconPublish16 /> : <IconLockLocked16 />}
          {board.settings.writeAllowed ? t('Can write') : t('Read only')}
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
            setCopied(ok ? t('Copied') : t('Copy failed'))
            setTimeout(() => setCopied(''), 1500)
          }}
        >
          {copied || t('Copy Markdown')}
        </Button>
      </div>
    </div>
  )
}

export default render(Plugin)
