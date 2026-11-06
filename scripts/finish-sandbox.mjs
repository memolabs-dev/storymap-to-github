// Second half of make-sandbox.mjs, for a sandbox whose issues already exist:
// rebuilds the sub-issue links (one by one, reporting failures) and creates
// the test project board. Reads the source, writes only to the sandbox.
//
// usage: node finish-sandbox.mjs <source owner/repo> <source project url> <sandbox owner/repo>
import { execFileSync } from 'node:child_process'
import * as core from '../src/core.js'

const [source, sourceProject, sandbox] = process.argv.slice(2)
if (sandbox.toLowerCase() === source.toLowerCase()) throw new Error('The sandbox must be another repository than the source: the source is never written to.')
const [sandboxOwner, sandboxName] = sandbox.split('/')
const env = { ...process.env }
delete env.GITHUB_TOKEN
const run = (args, input) => execFileSync('gh', args, { env, encoding: 'utf8', input, maxBuffer: 64 * 1024 * 1024 })
const get = (path) => JSON.parse(run(['api', '--paginate', '--slurp', path])).flat()
const graphql = (query, variables = {}) => {
  const out = JSON.parse(run(['api', 'graphql', '--input', '-'], JSON.stringify({ query, variables })))
  if (out.errors) throw new Error(JSON.stringify(out.errors))
  return out.data
}

const issues = get(`repos/${source}/issues?state=all&per_page=100`).filter((i) => !i.pull_request)
const copies = new Map(get(`repos/${sandbox}/issues?state=all&per_page=100`).map((i) => [i.number, i]))

// Sub-issues: skip links that already exist.
let made = 0
const failed = []
for (const src of issues) {
  if (!src.parent_issue_url) continue
  const parent = Number(src.parent_issue_url.split('/').pop())
  const child = copies.get(src.number)
  if (!child || !copies.has(parent)) continue
  if (child.parent_issue_url) continue
  try {
    run(['api', '-X', 'POST', `repos/${sandbox}/issues/${parent}/sub_issues`, '-F', `sub_issue_id=${child.id}`])
    made += 1
  } catch (err) {
    failed.push(`#${src.number} under #${parent}: ${String(err.stdout || err.message).slice(0, 120)}`)
  }
}
console.log(`${made} sub-issue links made${failed.length ? `, ${failed.length} failed:\n  ${failed.join('\n  ')}` : ''}`)

// The test project board.
const target = core.parseProjectUrl(sourceProject)
const pages = []
let cursor = null
do {
  const data = graphql(core.projectQuery(target.kind), { owner: target.owner, number: target.number, cursor })
  pages.push(data.owner.projectV2)
  cursor = data.owner.projectV2.items.pageInfo.hasNextPage ? data.owner.projectV2.items.pageInfo.endCursor : null
} while (cursor)
const board = core.readProject(pages)

const ids = graphql('query($o: String!, $r: String!) { organization(login: $o) { id projectsV2(first: 50) { nodes { id number title url } } } repository(owner: $o, name: $r) { id } }', { o: sandboxOwner, r: sandboxName })
let project = ids.organization.projectsV2.nodes.find((p) => p.title === 'Storymap sandbox')
if (!project) {
  project = graphql('mutation($o: ID!, $r: ID!) { createProjectV2(input: { ownerId: $o, title: "Storymap sandbox", repositoryId: $r }) { projectV2 { id number url } } }', { o: ids.organization.id, r: ids.repository.id }).createProjectV2.projectV2
}
console.log(`project ${project.url}`)

const fieldsQuery = 'query($p: ID!) { node(id: $p) { ... on ProjectV2 { fields(first: 50) { nodes { ... on ProjectV2SingleSelectField { id name options { id name } } ... on ProjectV2IterationField { id name configuration { iterations { id title } } } } } } } }'
const fields = () => graphql(fieldsQuery, { p: project.id }).node.fields.nodes.filter((f) => f && f.id)
const option = (name, color) => ({ name, color, description: '' })
let all = fields()
const statusField = all.find((f) => f.name === 'Status')
if (!statusField.options.some((o) => o.name === 'Backlog')) {
  graphql('mutation($f: ID!, $o: [ProjectV2SingleSelectFieldOptionInput!]!) { updateProjectV2Field(input: { fieldId: $f, singleSelectOptions: $o }) { clientMutationId } }', {
    f: statusField.id,
    o: [option('Backlog', 'GRAY'), option('Ready', 'BLUE'), option('In progress', 'YELLOW'), option('In review', 'PURPLE'), option('Done', 'GREEN')],
  })
}
if (!all.some((f) => f.name === 'Size')) {
  graphql('mutation($p: ID!, $o: [ProjectV2SingleSelectFieldOptionInput!]!) { createProjectV2Field(input: { projectId: $p, dataType: SINGLE_SELECT, name: "Size", singleSelectOptions: $o }) { clientMutationId } }', {
    p: project.id,
    o: ['XS', 'S', 'M', 'L', 'XL'].map((s) => option(s, 'GRAY')),
  })
}
if (!all.some((f) => f.name === 'Sprint')) {
  graphql('mutation($p: ID!, $c: ProjectV2IterationFieldConfigurationInput!) { createProjectV2Field(input: { projectId: $p, dataType: ITERATION, name: "Sprint", iterationConfiguration: $c }) { clientMutationId } }', {
    p: project.id,
    c: { startDate: board.sprints[0].start, duration: 7, iterations: board.sprints.map((s) => ({ title: s.title, startDate: s.start, duration: 7 })) },
  })
}
all = fields()
const status = all.find((f) => f.name === 'Status')
const size = all.find((f) => f.name === 'Size')
const sprint = all.find((f) => f.name === 'Sprint')
const setField = (itemId, fieldId, value) =>
  graphql('mutation($p: ID!, $i: ID!, $f: ID!, $v: ProjectV2FieldValue!) { updateProjectV2ItemFieldValue(input: { projectId: $p, itemId: $i, fieldId: $f, value: $v }) { clientMutationId } }', { p: project.id, i: itemId, f: fieldId, v: value })

// Items already on the board (a previous run, or GitHub adding them itself).
const existing = new Map()
let after = null
do {
  const page = graphql('query($p: ID!, $a: String) { node(id: $p) { ... on ProjectV2 { items(first: 100, after: $a) { pageInfo { hasNextPage endCursor } nodes { id content { ... on Issue { id } } } } } } }', { p: project.id, a: after }).node.items
  for (const n of page.nodes) if (n.content && n.content.id) existing.set(n.content.id, n.id)
  after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null
} while (after)

let items = 0
for (const src of issues) {
  const values = board.items[`${source}#${src.number}`.toLowerCase()]
  const copy = copies.get(src.number)
  if (!values || !copy) continue
  const item = existing.has(copy.node_id)
    ? { id: existing.get(copy.node_id) }
    : graphql('mutation($p: ID!, $c: ID!) { addProjectV2ItemById(input: { projectId: $p, contentId: $c }) { item { id } } }', { p: project.id, c: copy.node_id }).addProjectV2ItemById.item
  items += 1
  const st = values.status && status.options.find((o) => o.name === values.status)
  if (st) setField(item.id, status.id, { singleSelectOptionId: st.id })
  const sz = values.size && size.options.find((o) => o.name === values.size)
  if (sz) setField(item.id, size.id, { singleSelectOptionId: sz.id })
  const it = values.sprint && sprint.configuration.iterations.find((x) => x.title === values.sprint.title)
  if (it) setField(item.id, sprint.id, { iterationId: it.id })
}
console.log(`${items} items on the board with their status, size and sprint`)
console.log(`sprints: ${sprint.configuration.iterations.map((i) => i.title).join(', ')}`)
