// Pure helpers for the project navigator. They take plain data and return plain
// data, so the filtering rules can be tested without rendering anything.
import type { AgentSummary, ProjectSummary } from '../../types'

/** One row in the navigator: a project, its position in the list, and the agents to show under it. */
export interface NavProject {
  project: ProjectSummary
  /** Position in the full project order. Sets the sun colour, so the sidebar matches the universe. */
  index: number
  /** Agents to list when the project is expanded. While filtering, only matching agents appear. */
  agents: AgentSummary[]
  /** True when a query is active. Matching projects are then always shown expanded. */
  filtering: boolean
}

/** Normalises a search query. Blank queries mean "no filter". */
export function normaliseQuery(query: string): string {
  return query.trim().toLowerCase()
}

function contains(text: string, q: string): boolean {
  return text.toLowerCase().includes(q)
}

/**
 * Builds the navigator rows in project order.
 *
 * With no query, every project is listed with all of its agents. With a query, a project
 * is kept when its name or repository path matches (and then shows all its agents), or
 * when one of its agents matches (and then shows only those agents).
 */
export function buildNavProjects(
  order: string[],
  projects: Record<string, ProjectSummary>,
  agentsByProject: Map<string, AgentSummary[]>,
  query: string,
): NavProject[] {
  const q = normaliseQuery(query)
  const rows: NavProject[] = []
  order.forEach((id, index) => {
    const project = projects[id]
    if (!project) return
    const agents = agentsByProject.get(id) ?? []
    if (!q) {
      rows.push({ project, index, agents, filtering: false })
      return
    }
    const projectHit = contains(project.name, q) || contains(project.repoPath, q)
    const agentHits = agents.filter((a) => contains(a.name, q))
    if (!projectHit && agentHits.length === 0) return
    rows.push({ project, index, agents: projectHit ? agents : agentHits, filtering: true })
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
