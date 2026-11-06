// First half of the test bed for Storymap to GitHub: a copy of a real backlog
// (labels, milestones, issues with the same numbers). finish-sandbox.mjs then
// adds the sub-issues and a test project board (Status, Size, Sprint).
// It only READS the source repository and project, and only WRITES to the
// new sandbox repository and its new project.
//
// usage: node make-sandbox.mjs <source owner/repo> <source project url> <sandbox owner/repo>
import { execFileSync } from 'node:child_process'
import * as core from '../src/core.js'

const [source, sourceProject, sandbox] = process.argv.slice(2)
if (!source || !sourceProject || !sandbox) throw new Error('usage: node make-sandbox.mjs <source> <source project url> <sandbox>')
if (sandbox.toLowerCase() === source.toLowerCase()) throw new Error('The sandbox must be another repository than the source: the source is never written to.')
const [sandboxOwner, sandboxName] = sandbox.split('/')

const env = { ...process.env }
delete env.GITHUB_TOKEN
const gh = (args, input) => {
  const out = execFileSync('gh', args, { env, encoding: 'utf8', input, maxBuffer: 64 * 1024 * 1024 })
  return out.trim() ? JSON.parse(out) : null
}
const rest = (method, path, body) => gh(['api', '-X', method, path, '--input', '-'], JSON.stringify(body || {}))
const get = (path) => gh(['api', '--paginate', '--slurp', path]).flat()
const graphql = (query, variables = {}) => {
  const out = gh(['api', 'graphql', '--input', '-'], JSON.stringify({ query, variables }))
  if (out.errors) throw new Error(JSON.stringify(out.errors))
  return out.data
}
const log = (...a) => console.log(...a)
// Mentions are broken so nobody is notified by the copy.
const quiet = (s) => (s || '').replace(/@(?=[A-Za-z0-9-])/g, '@​')

// 1. Read the source --------------------------------------------------------
const labels = get(`repos/${source}/labels?per_page=100`)
const milestones = get(`repos/${source}/milestones?state=all&per_page=100`).sort((a, b) => a.number - b.number)
const issues = get(`repos/${source}/issues?state=all&per_page=100`)
const byNumber = new Map(issues.map((i) => [i.number, i]))
const max = Math.max(...issues.map((i) => i.number))
const target = core.parseProjectUrl(sourceProject)
const pages = []
let cursor = null
do {
  const data = graphql(core.projectQuery(target.kind), { owner: target.owner, number: target.number, cursor })
  pages.push(data.owner.projectV2)
  cursor = data.owner.projectV2.items.pageInfo.hasNextPage ? data.owner.projectV2.items.pageInfo.endCursor : null
} while (cursor)
const board = core.readProject(pages)
log(`source: ${issues.length} issues and pull requests, ${labels.length} labels, ${milestones.length} milestones, ${board.sprints.length} sprints`)

// 2. Create the sandbox repository ------------------------------------------
execFileSync('gh', ['repo', 'create', sandbox, '--private', '--description', 'Test bed for Storymap to GitHub: a copy of a real backlog, safe to write to'], { env, encoding: 'utf8' })
log(`created ${sandbox}`)
const targetTypes = new Set(get(`orgs/${sandboxOwner}/issue-types`).map((t) => t.name))

for (const l of labels) {
  try {
    rest('POST', `repos/${sandbox}/labels`, { name: l.name, color: l.color, description: l.description || '' })
  } catch {
    rest('PATCH', `repos/${sandbox}/labels/${encodeURIComponent(l.name)}`, { color: l.color, description: l.description || '' })
  }
}
if (!targetTypes.has('Epic')) {
  try { rest('POST', `repos/${sandbox}/labels`, { name: 'epic', color: '7057ff', description: 'Stands in for the Epic issue type, missing in this organisation' }) } catch {}
}
const milestoneNumber = new Map()
for (const m of milestones) {
  const made = rest('POST', `repos/${sandbox}/milestones`, { title: m.title, state: m.state, description: m.description || '', ...(m.due_on ? { due_on: m.due_on } : {}) })
  milestoneNumber.set(m.title, made.number)
}
log(`labels and ${milestones.length} milestones copied`)

// 3. Issues, with the same numbers ------------------------------------------
const made = new Map()
for (let n = 1; n <= max; n += 1) {
  const src = byNumber.get(n)
  if (!src || src.pull_request) {
    const p = rest('POST', `repos/${sandbox}/issues`, { title: `Placeholder #${n}`, body: `Keeps issue numbers aligned with ${source} (#${n} is ${src ? 'a pull request' : 'missing'} there).` })
    rest('PATCH', `repos/${sandbox}/issues/${p.number}`, { state: 'closed', state_reason: 'not_planned' })
    continue
  }
  const type = src.type ? src.type.name : null
  const issueLabels = src.labels.map((l) => l.name)
  if (type === 'Epic' && !targetTypes.has('Epic')) issueLabels.push('epic')
  const body = `${quiet(src.body)}\n\n---\nCopied from ${source}#${n} for testing. Edits here never reach the source.`
  const copy = rest('POST', `repos/${sandbox}/issues`, {
    title: src.title,
    body,
    labels: issueLabels,
    ...(src.milestone ? { milestone: milestoneNumber.get(src.milestone.title) } : {}),
    ...(type && targetTypes.has(type) ? { type } : {}),
  })
  if (copy.number !== n) throw new Error(`numbers drifted: expected #${n}, got #${copy.number}`)
  if (src.state === 'closed') rest('PATCH', `repos/${sandbox}/issues/${n}`, { state: 'closed', state_reason: src.state_reason || 'completed' })
  made.set(n, copy)
}
log(`${made.size} issues copied with the same numbers`)

log('next: node scripts/finish-sandbox.mjs with the same arguments, for the sub-issues and the project board')
