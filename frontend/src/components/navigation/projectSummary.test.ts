import { describe, expect, it } from 'vitest'
import type { AgentSummary, ProjectSummary, Status } from '../../types'
import { projectStatus, projectSummary } from './projectSummary'

function agent(status: Status, running = false): AgentSummary {
  return { id: status, status, running } as AgentSummary
}

function project(overrides: Partial<ProjectSummary> = {}): ProjectSummary {
  return { id: 'p', name: 'Orbit', repoPath: 'C:\\x', createdAt: 0, agentCount: 0, runningCount: 0, conflicts: [], handoffs: [], conversations: [], ...overrides } as ProjectSummary
}

describe('projectStatus', () => {
  it('is null for a project with no agents', () => {
    expect(projectStatus([])).toBeNull()
  })

  it('shows a failure over live work, so it is never hidden', () => {
    expect(projectStatus([agent('thinking'), agent('failed')])).toBe('failed')
  })

  it('shows live work over finished or idle agents', () => {
    expect(projectStatus([agent('completed'), agent('idle'), agent('writing')])).toBe('writing')
  })

  it('shows a success over an idle agent', () => {
    expect(projectStatus([agent('stopped'), agent('completed')])).toBe('completed')
  })

  it('breaks ties by the agent listed first', () => {
    expect(projectStatus([agent('reading'), agent('thinking')])).toBe('reading')
  })
})

describe('projectSummary', () => {
  it('adds no label when a project has no agents', () => {
    expect(projectSummary(project(), [])).toEqual([])
  })

  it('counts agents, singular and plural', () => {
    expect(projectSummary(project(), [agent('idle')]).at(-1)?.text).toBe('1 agent')
    expect(projectSummary(project(), [agent('idle'), agent('idle'), agent('idle')]).at(-1)?.text).toBe('3 agents')
  })

  it('counts running from the agents themselves, not the stored total', () => {
    const agents = [agent('thinking', true), agent('idle'), agent('writing', true), agent('completed')]
    const parts = projectSummary(project({ runningCount: 9 }), agents)
    expect(parts).toEqual([
      { text: '2 running', tone: 'live' },
      { text: '4 agents', tone: 'muted' },
    ])
  })

  it('lists conflicts first, then running work, then the agent count', () => {
    const parts = projectSummary(project({ conflicts: [{ path: 'a', agents: [] }] }), [agent('thinking', true), agent('idle')])
    expect(parts).toEqual([
      { text: '1 conflict', tone: 'warn' },
      { text: '1 running', tone: 'live' },
      { text: '2 agents', tone: 'muted' },
    ])
  })

  it('reads "shown of total" while a filter narrows the agents', () => {
    const all = [agent('idle'), agent('idle'), agent('idle'), agent('idle'), agent('idle')]
    expect(projectSummary(project(), all, 2).at(-1)?.text).toBe('2 of 5 agents')
  })
})
