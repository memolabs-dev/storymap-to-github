// Compares the sandbox with its source: titles, milestones, parents, state,
// and the status, size and sprint of every board item. Read-only on both.
import { execFileSync } from 'node:child_process'
import * as core from '../src/core.js'

const [source, sourceProject, sandbox, sandboxProject] = process.argv.slice(2)
const env = { ...process.env }
delete env.GITHUB_TOKEN
const run = (args) => execFileSync('gh', args, { env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
const get = (path) => JSON.parse(run(['api', '--paginate', '--slurp', path])).flat().filter((i) => !i.pull_request)
const board = (url) => {
  const t = core.parseProjectUrl(url)
  const pages = []
  let cursor = null
  do {
    const out = JSON.parse(run(['api', 'graphql', '-f', `query=${core.projectQuery(t.kind)}`, '-F', `owner=${t.owner}`, '-F', `number=${t.number}`, ...(cursor ? ['-f', `cursor=${cursor}`] : [])]))
    pages.push(out.data.owner.projectV2)
    cursor = out.data.owner.projectV2.items.pageInfo.hasNextPage ? out.data.owner.projectV2.items.pageInfo.endCursor : null
  } while (cursor)
  return core.readProject(pages)
}
const shape = (i) => ({
  title: i.title,
  state: i.state,
  milestone: i.milestone ? i.milestone.title : null,
  parent: i.parent_issue_url ? Number(i.parent_issue_url.split('/').pop()) : null,
  labels: i.labels.map((l) => l.name).filter((l) => l !== 'epic').sort().join(','),
})
const a = new Map(get(`repos/${source}/issues?state=all&per_page=100`).map((i) => [i.number, shape(i)]))
const b = new Map(get(`repos/${sandbox}/issues?state=all&per_page=100`).map((i) => [i.number, shape(i)]))
const diffs = []
for (const [n, x] of a) {
  const y = b.get(n)
  if (!y) { diffs.push(`#${n} missing`); continue }
  for (const k of Object.keys(x)) if (x[k] !== y[k]) diffs.push(`#${n} ${k}: ${x[k]} vs ${y[k]}`)
}
const pa = board(sourceProject)
const pb = board(sandboxProject)
for (const [key, v] of Object.entries(pa.items)) {
  const n = key.split('#')[1]
  const w = pb.items[`${sandbox}#${n}`.toLowerCase()]
  if (!w) { diffs.push(`board #${n} missing`); continue }
  for (const k of ['status', 'size']) if ((v[k] || null) !== (w[k] || null)) diffs.push(`board #${n} ${k}: ${v[k]} vs ${w[k]}`)
  if ((v.sprint && v.sprint.title) !== (w.sprint && w.sprint.title)) diffs.push(`board #${n} sprint: ${v.sprint && v.sprint.title} vs ${w.sprint && w.sprint.title}`)
}
console.log(`${a.size} issues and ${Object.keys(pa.items).length} board items compared; sprints ${pb.sprints.map((s) => `${s.title} ${s.start}..${s.end}`).join(' | ')}`)
console.log(diffs.length ? `${diffs.length} differences:\n  ${diffs.join('\n  ')}` : 'no difference')
