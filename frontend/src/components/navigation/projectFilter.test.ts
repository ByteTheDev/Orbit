import { describe, expect, it } from 'vitest'
import type { AgentSummary, ProjectSummary } from '../../types'
import { NO_FILTER, buildNavProjects, groupAgents, isFiltering, normaliseQuery, providersIn, type NavFilter } from './projectFilter'

function project(id: string, name: string, repoPath = `C:\\work\\${name.toLowerCase()}`): ProjectSummary {
  return { id, name, repoPath, createdAt: 0, agentCount: 0, runningCount: 0, conflicts: [], handoffs: [], conversations: [] }
}

function agent(id: string, projectId: string, name: string, over: Partial<AgentSummary> = {}): AgentSummary {
  return { id, projectId, name, provider: 'claude', providerName: 'Claude', status: 'idle', running: false, task: '', statusDetail: '', ...over } as AgentSummary
}

const f = (over: Partial<NavFilter>): NavFilter => ({ ...NO_FILTER, ...over })

const projects = {
  p1: project('p1', 'SuperStar'),
  p2: project('p2', 'Orbit', 'C:\\Users\\spoil\\Desktop\\Orbit'),
  p3: project('p3', 'Blog'),
}
const order = ['p1', 'p2', 'p3']
const agents = groupAgents([
  agent('a1', 'p1', 'Claude 1'),
  agent('a2', 'p1', 'Scout', { status: 'waiting', provider: 'codex', providerName: 'Codex' }),
  agent('a3', 'p2', 'Codex 1', { provider: 'codex', providerName: 'Codex', status: 'writing', running: true }),
])

describe('buildNavProjects', () => {
  it('lists every project in order, with all agents, when there is no filter', () => {
    const rows = buildNavProjects(order, projects, agents, NO_FILTER)
    expect(rows.map((r) => r.project.id)).toEqual(['p1', 'p2', 'p3'])
    expect(rows[0].agents.map((a) => a.id)).toEqual(['a1', 'a2'])
    expect(rows.every((r) => !r.filtering)).toBe(true)
  })

  it('treats a whitespace-only query as no filter', () => {
    expect(buildNavProjects(order, projects, agents, f({ query: '   ' })).every((r) => !r.filtering)).toBe(true)
  })

  it('keeps each project index so the sidebar colour matches the universe', () => {
    const rows = buildNavProjects(order, projects, agents, f({ query: 'blog' }))
    expect(rows).toHaveLength(1)
    expect(rows[0].index).toBe(2)
  })

  it('matches project names, case-insensitively, and shows all of that project’s agents', () => {
    const rows = buildNavProjects(order, projects, agents, f({ query: 'SUPER' }))
    expect(rows.map((r) => r.project.id)).toEqual(['p1'])
    expect(rows[0].agents.map((a) => a.id)).toEqual(['a1', 'a2'])
    expect(rows[0].filtering).toBe(true)
  })

  it('matches repository paths', () => {
    expect(buildNavProjects(order, projects, agents, f({ query: 'desktop\\orbit' })).map((r) => r.project.id)).toEqual(['p2'])
  })

  it('shows only matching agents when just an agent matches, keeping the project total for the count', () => {
    const rows = buildNavProjects(order, projects, agents, f({ query: 'scout' }))
    expect(rows.map((r) => r.project.id)).toEqual(['p1'])
    expect(rows[0].agents.map((a) => a.id)).toEqual(['a2'])
    expect(rows[0].allAgents).toHaveLength(2)
  })

  it('matches what an agent was asked to do and what it is doing', () => {
    const list = groupAgents([agent('x', 'p3', 'Quiet', { task: 'migrate the billing tables', statusDetail: 'Reading schema.sql' })])
    const withTask = buildNavProjects(['p3'], projects, list, f({ query: 'billing' }))
    expect(withTask[0].agents.map((a) => a.id)).toEqual(['x'])
    const withDetail = buildNavProjects(['p3'], projects, list, f({ query: 'schema' }))
    expect(withDetail[0].agents.map((a) => a.id)).toEqual(['x'])
  })

  it('returns nothing when no project or agent matches', () => {
    expect(buildNavProjects(order, projects, agents, f({ query: 'zzz' }))).toEqual([])
  })

  it('filters by provider, keeping only that provider’s agents', () => {
    const rows = buildNavProjects(order, projects, agents, f({ provider: 'codex' }))
    expect(rows.map((r) => r.project.id)).toEqual(['p1', 'p2'])
    expect(rows[0].agents.map((a) => a.id)).toEqual(['a2'])
    expect(rows[1].agents.map((a) => a.id)).toEqual(['a3'])
  })

  it('filters by status group, so blocked agents show under attention, not running', () => {
    expect(buildNavProjects(order, projects, agents, f({ bucket: 'attention' })).map((r) => r.agents.map((a) => a.id))).toEqual([['a2']])
    expect(buildNavProjects(order, projects, agents, f({ bucket: 'running' })).map((r) => r.agents.map((a) => a.id))).toEqual([['a3']])
  })

  it('combines text, provider and status; a project name hit does not bypass the chips', () => {
    const rows = buildNavProjects(order, projects, agents, f({ query: 'super', provider: 'codex' }))
    expect(rows.map((r) => r.agents.map((a) => a.id))).toEqual([['a2']])
    expect(buildNavProjects(order, projects, agents, f({ query: 'orbit', bucket: 'idle' }))).toEqual([])
  })

  it('skips ids that have no project record', () => {
    expect(buildNavProjects(['missing', 'p3'], projects, agents, NO_FILTER).map((r) => r.project.id)).toEqual(['p3'])
  })

  it('stays fast with many projects and agents', () => {
    const many: Record<string, ProjectSummary> = {}
    const ids: string[] = []
    const list: AgentSummary[] = []
    for (let p = 0; p < 60; p++) {
      const id = `proj${p}`
      ids.push(id)
      many[id] = project(id, `Project ${p}`)
      for (let a = 0; a < 25; a++) list.push(agent(`${id}-${a}`, id, `Agent ${a}`, { status: a % 7 === 0 ? 'failed' : 'thinking', running: a % 7 !== 0 }))
    }
    const grouped = groupAgents(list)
    const started = performance.now()
    for (let i = 0; i < 50; i++) buildNavProjects(ids, many, grouped, f({ query: 'agent 1', provider: 'claude', bucket: 'running' }))
    expect(performance.now() - started).toBeLessThan(500)
    expect(buildNavProjects(ids, many, grouped, NO_FILTER)).toHaveLength(60)
  })
})

describe('isFiltering', () => {
  it('is false only when every axis is empty', () => {
    expect(isFiltering(NO_FILTER)).toBe(false)
    expect(isFiltering(f({ query: ' ' }))).toBe(false)
    expect(isFiltering(f({ provider: 'claude' }))).toBe(true)
    expect(isFiltering(f({ bucket: 'done' }))).toBe(true)
    expect(isFiltering(f({ query: 'x' }))).toBe(true)
  })
})

describe('providersIn', () => {
  it('lists each provider once, in first-seen order', () => {
    expect(providersIn([...agents.values()].flat())).toEqual([
      { id: 'claude', name: 'Claude' },
      { id: 'codex', name: 'Codex' },
    ])
  })
})

describe('normaliseQuery', () => {
  it('trims and lowercases', () => {
    expect(normaliseQuery('  Hello ')).toBe('hello')
  })
})

describe('groupAgents', () => {
  it('groups by project and keeps arrival order', () => {
    const map = groupAgents([agent('x', 'p1', 'A'), agent('y', 'p2', 'B'), agent('z', 'p1', 'C')])
    expect(map.get('p1')?.map((a) => a.id)).toEqual(['x', 'z'])
    expect(map.get('p2')?.map((a) => a.id)).toEqual(['y'])
  })
})
