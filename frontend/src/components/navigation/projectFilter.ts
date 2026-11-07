// Pure helpers for the project navigator. They take plain data and return plain
// data, so the filtering rules can be tested without rendering anything.
import type { AgentSummary, ProjectSummary } from '../../types'
import { agentBucket, type AgentBucket } from './agentStatus'

/** One row in the navigator: a project, its position in the list, and the agents to show under it. */
export interface NavProject {
  project: ProjectSummary
  /** Position in the full project order. Sets the sun colour, so the sidebar matches the universe. */
  index: number
  /** Agents to list under the project. While filtering, only matching agents appear. */
  agents: AgentSummary[]
  /** Every agent in the project, whatever the filter. Counts and the row status come from these. */
  allAgents: AgentSummary[]
  /** True when any filter is active. Matching projects are then always shown expanded. */
  filtering: boolean
}

/** What the user has asked the navigator to show. Empty fields mean "no filter" on that axis. */
export interface NavFilter {
  query: string
  /** Provider id, such as "claude" or "codex". Null means every provider. */
  provider: string | null
  /** Status group. Null means every status. */
  bucket: AgentBucket | null
}

export const NO_FILTER: NavFilter = { query: '', provider: null, bucket: null }

/** Normalises a search query. Blank queries mean "no filter". */
export function normaliseQuery(query: string): string {
  return query.trim().toLowerCase()
}

/** True when any axis of the filter narrows the list. */
export function isFiltering(filter: NavFilter): boolean {
  return normaliseQuery(filter.query) !== '' || filter.provider !== null || filter.bucket !== null
}

function contains(text: string | undefined, q: string): boolean {
  return (text ?? '').toLowerCase().includes(q)
}

/** Text search over an agent's name, what it was asked to do, what it is doing, and its provider. */
function agentTextHit(a: AgentSummary, q: string): boolean {
  return !q || contains(a.name, q) || contains(a.task, q) || contains(a.statusDetail, q) || contains(a.providerName, q)
}

/**
 * Builds the navigator rows in project order.
 *
 * With no filter, every project is listed with all of its agents. With a filter, an agent is
 * kept when it matches the text, the provider and the status group. A project is kept when its
 * name or repository path matches the text (and then shows its agents that pass the chips), or
 * when any of its agents is kept (and then shows just those agents).
 */
export function buildNavProjects(
  order: string[],
  projects: Record<string, ProjectSummary>,
  agentsByProject: Map<string, AgentSummary[]>,
  filter: NavFilter,
): NavProject[] {
  const q = normaliseQuery(filter.query)
  const chips = filter.provider !== null || filter.bucket !== null
  const rows: NavProject[] = []

  order.forEach((id, index) => {
    const project = projects[id]
    if (!project) return
    const agents = agentsByProject.get(id) ?? []
    if (!isFiltering(filter)) {
      rows.push({ project, index, agents, allAgents: agents, filtering: false })
      return
    }

    const projectHit = q !== '' && (contains(project.name, q) || contains(project.repoPath, q))
    // A project-name hit lets its agents through the text test, so "super" plus a provider chip
    // still lists SuperStar's Codex agents.
    const passing = agents.filter(
      (a) =>
        (projectHit || agentTextHit(a, q)) &&
        (filter.provider === null || a.provider === filter.provider) &&
        (filter.bucket === null || agentBucket(a.status) === filter.bucket),
    )

    if (projectHit && !chips) {
      rows.push({ project, index, agents, allAgents: agents, filtering: true })
      return
    }
    if (passing.length === 0) return
    rows.push({ project, index, agents: passing, allAgents: agents, filtering: true })
  })
  return rows
}

/** Groups agents by project id, keeping the order they arrive in. */
export function groupAgents(agents: AgentSummary[]): Map<string, AgentSummary[]> {
  const map = new Map<string, AgentSummary[]>()
  for (const a of agents) {
    const list = map.get(a.projectId)
    if (list) list.push(a)
    else map.set(a.projectId, [a])
  }
  return map
}

/** The providers present among the agents, in first-seen order, for the provider chips. */
export function providersIn(agents: AgentSummary[]): { id: string; name: string }[] {
  const seen = new Map<string, string>()
  for (const a of agents) {
    if (!seen.has(a.provider)) seen.set(a.provider, a.providerName || a.provider)
  }
  return [...seen].map(([id, name]) => ({ id, name }))
}
