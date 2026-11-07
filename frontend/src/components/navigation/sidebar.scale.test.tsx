// Smoke and scale checks for the sidebar components. They render to static markup, so no DOM is
// needed: the test catches crashes, bad keys, and runaway output with many projects and agents.
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { AgentSummary, ProjectSummary, Status } from '../../types'
import { ActiveAgents } from './ActiveAgents'
import { AgentItem } from './AgentItem'
import { ProjectItem } from './ProjectItem'
import { ProjectRail } from './ProjectRail'
import { SidebarFilters } from './SidebarFilters'
import { buildNavProjects, groupAgents, NO_FILTER } from './projectFilter'

const STATUSES: Status[] = ['thinking', 'writing', 'reading', 'waiting', 'completed', 'failed', 'idle', 'stopped']

function makeFleet(projectCount: number, agentsPerProject: number) {
  const projects: Record<string, ProjectSummary> = {}
  const order: string[] = []
  const agents: AgentSummary[] = []
  for (let p = 0; p < projectCount; p++) {
    const id = `p${p}`
    order.push(id)
    projects[id] = {
      id,
      name: p % 5 === 0 ? `A very long project name that keeps going and going ${p}` : `Project ${p}`,
      repoPath: `C:\\work\\project-${p}`,
      createdAt: 0,
      agentCount: agentsPerProject,
      runningCount: 0,
      conflicts: [],
      handoffs: [], conversations: [],
    }
    for (let a = 0; a < agentsPerProject; a++) {
      const status = STATUSES[(p + a) % STATUSES.length]
      agents.push({
        id: `${id}-a${a}`,
        projectId: id,
        name: `Agent ${a}`,
        provider: a % 2 === 0 ? 'claude' : 'codex',
        providerName: a % 2 === 0 ? 'Claude' : 'Codex',
        model: a % 2 === 0 ? 'claude-opus-5-5' : '',
        task: `Work item ${p}-${a}`,
        status,
        statusDetail: status === 'reading' ? 'Reading src/lib/store.ts' : '',
        running: ['thinking', 'writing', 'reading'].includes(status),
        toolCalls: a,
        issueCount: status === 'failed' ? 1 : 0,
      } as AgentSummary)
    }
  }
  return { projects, order, agents, byProject: groupAgents(agents) }
}

describe('sidebar at scale', () => {
  const fleet = makeFleet(60, 25)

  it('renders the full project tree with every agent row, without errors', () => {
    const rows = buildNavProjects(fleet.order, fleet.projects, fleet.byProject, NO_FILTER)
    const started = performance.now()
    // Worst case: every project expanded at once. The sidebar only does that when a filter forces it.
    const html = renderToStaticMarkup(
      <ul>
        {rows.map((row) => (
          <ProjectItem
            key={row.project.id}
            nav={row}
            active={row.project.id === 'p0'}
            expanded
            selectedAgentId={null}
            onToggle={() => {}}
            onSelect={() => {}}
            onFocusAgent={() => {}}
            onContextMenu={() => {}}
            onAgentContextMenu={() => {}}
          />
        ))}
      </ul>,
    )
    expect(performance.now() - started).toBeLessThan(2000)
    expect(rows).toHaveLength(60)
    // Per project: its header button, one button per agent, and the "Launch agent here" button.
    expect((html.match(/data-nav-item/g) ?? []).length).toBe(60 * (1 + 25 + 1))
  })

  it('keeps the usual view small: only the active project is expanded by default', () => {
    const rows = buildNavProjects(fleet.order, fleet.projects, fleet.byProject, NO_FILTER)
    const html = renderToStaticMarkup(
      <ul>
        {rows.map((row) => (
          <ProjectItem
            key={row.project.id}
            nav={row}
            active={row.project.id === 'p0'}
            expanded={row.project.id === 'p0'}
            selectedAgentId={null}
            onToggle={() => {}}
            onSelect={() => {}}
            onFocusAgent={() => {}}
            onContextMenu={() => {}}
            onAgentContextMenu={() => {}}
          />
        ))}
      </ul>,
    )
    // One project's 25 agent rows, plus 59 collapsed headers: well under a megabyte.
    expect(html.length).toBeLessThan(400_000)
  })

  it('shows a project name in full to hover, but truncates it on screen', () => {
    const row = buildNavProjects(fleet.order, fleet.projects, fleet.byProject, NO_FILTER)[0]
    const html = renderToStaticMarkup(
      <ProjectItem nav={row} active={false} expanded={false} selectedAgentId={null} onToggle={() => {}} onSelect={() => {}} onFocusAgent={() => {}} onContextMenu={() => {}} onAgentContextMenu={() => {}} />,
    )
    expect(html).toContain('title="A very long project name that keeps going and going 0"')
    expect(html).toContain('truncate')
  })

  it('gives each agent row a name, a line of detail, and an actions button', () => {
    const html = renderToStaticMarkup(<AgentItem agent={fleet.agents[0]} selected={false} onSelect={() => {}} onOpenMenu={() => {}} />)
    expect(html).toContain('Agent 0')
    expect(html).toContain('Actions for Agent 0')
    expect(html).toContain('opus-5-5')
  })

  it('lists only running and attention agents in the Active strip, capped to a preview', () => {
    const html = renderToStaticMarkup(<ActiveAgents agents={fleet.agents} projects={fleet.projects} selectedId={null} onFocusAgent={() => {}} />)
    expect(html).toContain('aria-label="Active agents"')
    expect(html).toContain('Show ')
    // The preview is four rows; the rest sit behind "Show more".
    expect((html.match(/data-nav-item/g) ?? []).length).toBe(4)
  })

  it('says so when nothing is active', () => {
    const quiet = fleet.agents.map((a) => ({ ...a, status: 'idle' as Status, running: false }))
    const html = renderToStaticMarkup(<ActiveAgents agents={quiet} projects={fleet.projects} selectedId={null} onFocusAgent={() => {}} />)
    expect(html).toContain('Nothing running right now')
  })

  it('renders the collapsed rail with one mark per project and a status dot where work is happening', () => {
    const rows = fleet.order.map((id) => ({ project: fleet.projects[id], agents: fleet.byProject.get(id) ?? [] }))
    const html = renderToStaticMarkup(<ProjectRail rows={rows} activeId="p0" onSelect={() => {}} onExpand={() => {}} onKeyDown={() => {}} />)
    expect(html.split('aria-current="true"').length - 1).toBe(1)
    expect((html.match(/data-nav-item/g) ?? []).length).toBe(60)
  })

  it('renders the filter chips, with a provider row only when there is more than one provider', () => {
    const counts = { running: 3, attention: 2, done: 1, idle: 4 }
    const multi = renderToStaticMarkup(
      <SidebarFilters query="" onQuery={() => {}} provider={null} providers={[{ id: 'claude', name: 'Claude' }, { id: 'codex', name: 'Codex' }]} onProvider={() => {}} bucket={null} bucketCounts={counts} onBucket={() => {}} onReset={() => {}} />,
    )
    expect(multi).toContain('Filter by provider')
    const single = renderToStaticMarkup(
      <SidebarFilters query="" onQuery={() => {}} provider={null} providers={[{ id: 'claude', name: 'Claude' }]} onProvider={() => {}} bucket={null} bucketCounts={counts} onBucket={() => {}} onReset={() => {}} />,
    )
    expect(single).not.toContain('Filter by provider')
  })

  it('keeps a filtered project’s count honest: "shown of total"', () => {
    const rows = buildNavProjects(fleet.order, fleet.projects, fleet.byProject, { query: '', provider: 'codex', bucket: null })
    const html = renderToStaticMarkup(
      <ProjectItem nav={rows[0]} active={false} expanded={false} selectedAgentId={null} onToggle={() => {}} onSelect={() => {}} onFocusAgent={() => {}} onContextMenu={() => {}} onAgentContextMenu={() => {}} />,
    )
    expect(html).toMatch(/\d+ of 25 agents/)
  })
})
