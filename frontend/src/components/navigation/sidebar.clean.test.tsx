// What the cleaned-up sidebar must and must not render. Static markup, so no DOM is needed.
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { AgentSummary, ProjectSummary, Status } from '../../types'
import { ActiveAgents } from './ActiveAgents'
import { ProjectItem } from './ProjectItem'
import { buildNavProjects, groupAgents, NO_FILTER } from './projectFilter'

function project(id: string): ProjectSummary {
  return {
    id,
    name: `Project ${id}`,
    repoPath: `C:\\work\\${id}`,
    createdAt: 0,
    agentCount: 0,
    runningCount: 0,
    conflicts: [],
    handoffs: [],
    conversations: [],
  } as ProjectSummary
}

function agent(id: string, projectId: string, status: Status = 'idle'): AgentSummary {
  return {
    id,
    projectId,
    name: `Agent ${id}`,
    provider: 'claude',
    providerName: 'Claude',
    model: '',
    task: '',
    status,
    statusDetail: '',
    running: status === 'thinking',
    toolCalls: 0,
    issueCount: 0,
  } as AgentSummary
}

/** Renders one project row, expanded, the way the sidebar does when a project is open. */
function renderRow(projects: ProjectSummary[], agents: AgentSummary[], filtering = false) {
  const projectMap = Object.fromEntries(projects.map((p) => [p.id, p]))
  const byProject = groupAgents(agents)
  const rows = buildNavProjects(
    projects.map((p) => p.id),
    projectMap,
    byProject,
    // "project" matches every test project's name, so the row is shown and only the filter state differs.
    filtering ? { ...NO_FILTER, query: 'project' } : NO_FILTER,
  )
  return renderToStaticMarkup(
    <ul>
      {rows.map((row) => (
        <ProjectItem
          key={row.project.id}
          nav={row}
          active={false}
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
}

describe('empty project', () => {
  it('shows one launch action and no other label', () => {
    const html = renderRow([project('a')], [])
    expect(html.match(/Launch agent/g)).toHaveLength(1)
    expect(html).not.toContain('No agents yet')
    expect(html).not.toContain('No agents')
  })

  it('shows no launch action while a filter is on', () => {
    const html = renderRow([project('a')], [], true)
    expect(html).toContain('Project a') // the row is there, so the absence below is the filter's doing
    expect(html).not.toContain('Launch agent')
  })
})

describe('project with agents', () => {
  it('lists its agents without a launch row', () => {
    const html = renderRow([project('a')], [agent('1', 'a'), agent('2', 'a')])
    expect(html).not.toContain('Launch agent')
    expect(html).toContain('Agent 1')
    expect(html).toContain('Agent 2')
  })
})

describe('sidebar fills and focus', () => {
  it('uses the faint sidebar fills, not the general row fills', () => {
    const html = renderRow([project('a')], [agent('1', 'a', 'thinking')])
    expect(html).not.toContain('bg-row-hover')
    expect(html).not.toContain('bg-row-active')
    expect(html).toContain('bg-nav-hover')
  })

  it('gives every navigation button the inset focus class', () => {
    const html = renderRow([project('a')], [agent('1', 'a')])
    const buttons = html.match(/<button[^>]*data-nav-item[^>]*>/g) ?? []
    expect(buttons.length).toBeGreaterThan(0)
    for (const b of buttons) expect(b).toContain('nav-item')
  })
})

describe('active agents', () => {
  it('draws nothing when no agent needs attention or is running', () => {
    const html = renderToStaticMarkup(
      <ActiveAgents agents={[agent('1', 'a', 'idle')]} projects={{ a: project('a') }} selectedId={null} onFocusAgent={() => {}} />,
    )
    expect(html).toBe('')
  })
})
