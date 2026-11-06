import { describe, expect, it } from 'vitest'
import type { AgentSummary, ProjectSummary } from '../../types'
import { buildNavProjects, groupAgents, normaliseQuery } from './projectFilter'

function project(id: string, name: string, repoPath = `C:\\work\\${name.toLowerCase()}`): ProjectSummary {
  return { id, name, repoPath, createdAt: 0, agentCount: 0, runningCount: 0, conflicts: [] }
}

function agent(id: string, projectId: string, name: string): AgentSummary {
  return { id, projectId, name } as AgentSummary
}

const projects = {
  p1: project('p1', 'SuperStar'),
  p2: project('p2', 'Orbit', 'C:\\Users\\spoil\\Desktop\\Orbit'),
  p3: project('p3', 'Blog'),
}
const order = ['p1', 'p2', 'p3']
const agents = groupAgents([agent('a1', 'p1', 'Claude 1'), agent('a2', 'p1', 'Scout'), agent('a3', 'p2', 'Codex 1')])

describe('buildNavProjects', () => {
  it('lists every project in order, with all agents, when the query is blank', () => {
    const rows = buildNavProjects(order, projects, agents, '   ')
    expect(rows.map((r) => r.project.id)).toEqual(['p1', 'p2', 'p3'])
    expect(rows[0].agents.map((a) => a.id)).toEqual(['a1', 'a2'])
    expect(rows.every((r) => !r.filtering)).toBe(true)
  })

  it('keeps each project index so the sidebar colour matches the universe', () => {
    const rows = buildNavProjects(order, projects, agents, 'blog')
    expect(rows).toHaveLength(1)
    expect(rows[0].index).toBe(2)
  })

  it('matches project names, case-insensitively, and shows all of that project’s agents', () => {
    const rows = buildNavProjects(order, projects, agents, 'SUPER')
    expect(rows.map((r) => r.project.id)).toEqual(['p1'])
    expect(rows[0].agents.map((a) => a.id)).toEqual(['a1', 'a2'])
    expect(rows[0].filtering).toBe(true)
  })

  it('matches repository paths', () => {
    const rows = buildNavProjects(order, projects, agents, 'desktop\\orbit')
    expect(rows.map((r) => r.project.id)).toEqual(['p2'])
  })

  it('shows only matching agents when just an agent matches', () => {
    const rows = buildNavProjects(order, projects, agents, 'scout')
    expect(rows.map((r) => r.project.id)).toEqual(['p1'])
    expect(rows[0].agents.map((a) => a.id)).toEqual(['a2'])
  })

  it('returns nothing when no project or agent matches', () => {
    expect(buildNavProjects(order, projects, agents, 'zzz')).toEqual([])
  })

  it('skips ids that have no project record', () => {
    const rows = buildNavProjects(['missing', 'p3'], projects, agents, '')
    expect(rows.map((r) => r.project.id)).toEqual(['p3'])
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
