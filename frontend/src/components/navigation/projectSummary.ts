// What a project row says about itself. Pure, so the rules can be tested without React.
import { plural } from '../../lib/format'
import type { AgentSummary, ProjectSummary, Status } from '../../types'
import { statusKind, type StatusKind } from './agentStatus'

/** Lower is more urgent. A failure outranks live work so it is never hidden behind a busy agent. */
const URGENCY: Record<StatusKind, number> = { failed: 0, live: 1, done: 2, idle: 3 }

/**
 * The single status a project row shows: the most urgent state among its agents, or null
 * when it has none. Ties go to the agent listed first.
 */
export function projectStatus(agents: AgentSummary[]): Status | null {
  let best: Status | null = null
  let bestRank = Infinity
  for (const a of agents) {
    const rank = URGENCY[statusKind(a.status)]
    if (rank < bestRank) {
      best = a.status
      bestRank = rank
    }
  }
  return best
}

export interface SummaryPart {
  text: string
  /** live: work in progress. warn: needs a look. muted: everything else. */
  tone: 'live' | 'warn' | 'muted'
}

/**
 * The line under a project's name: conflicts first (they need action), then what is running,
 * then the agent count. Counts come from the agents passed in, so they always match the rows
 * beneath. While a filter narrows the list, `shown` is how many agents are listed and the count
 * reads "2 of 5 agents".
 */
export function projectSummary(project: ProjectSummary, agents: AgentSummary[], shown = agents.length): SummaryPart[] {
  const parts: SummaryPart[] = []
  if (project.conflicts.length > 0) parts.push({ text: plural(project.conflicts.length, 'conflict'), tone: 'warn' })
  const running = agents.filter((a) => a.running).length
  if (running > 0) parts.push({ text: `${running} running`, tone: 'live' })
  // A project with no agents gets no count: its expanded list offers the one launch action instead.
  if (agents.length > 0) {
    const count = shown !== agents.length ? `${shown} of ${plural(agents.length, 'agent')}` : plural(agents.length, 'agent')
    parts.push({ text: count, tone: 'muted' })
  }
  return parts
}
