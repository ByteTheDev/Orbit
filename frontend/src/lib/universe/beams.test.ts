import { describe, expect, it } from 'vitest'
import { HANDOFF_FADE_MS, beamAlpha, computeBeams } from './beams'
import type { AgentSummary, FileActivity, Handoff } from '../../types'

function agent(id: string, projectId = 'p1', files: Partial<FileActivity>[] = []): AgentSummary {
  return {
    id,
    projectId,
    name: id,
    recentFiles: files.map((f) => ({ path: 'x', reads: 0, writes: 0, state: 'recent', lastOp: '', lastAt: 0, ...f })),
  } as unknown as AgentSummary
}

function handoff(over: Partial<Handoff> = {}): Handoff {
  return {
    id: 'h1',
    projectId: 'p1',
    fromId: 'a',
    toId: 'b',
    task: 'do it',
    status: 'active',
    at: 1000,
    ...over,
  }
}

describe('computeBeams: delegation and handoffs', () => {
  it('draws an active handoff as a delegation beam', () => {
    const beams = computeBeams([agent('a'), agent('b')], [handoff()], 2000)
    expect(beams).toEqual([{ key: 'h:h1', kind: 'delegation', fromId: 'a', toId: 'b', files: [], age: 0 }])
  })

  it('keeps a finished handoff for a short fade, then drops it', () => {
    const agents = [agent('a'), agent('b')]
    const done = handoff({ status: 'done', doneAt: 5000 })
    const fresh = computeBeams(agents, [done], 5000 + 1000)
    expect(fresh).toHaveLength(1)
    expect(fresh[0].kind).toBe('handoff')
    expect(fresh[0].age).toBe(1000)
    expect(computeBeams(agents, [done], 5000 + HANDOFF_FADE_MS)).toHaveLength(0)
  })

  it('marks a failed handoff as failed, not as a success', () => {
    const beams = computeBeams([agent('a'), agent('b')], [handoff({ status: 'failed', doneAt: 5000 })], 5100)
    expect(beams[0].kind).toBe('failed')
  })

  it('drops handoffs whose agents are gone or that point at the same agent', () => {
    const agents = [agent('a'), agent('b')]
    expect(computeBeams(agents, [handoff({ toId: 'gone' })], 2000)).toEqual([])
    expect(computeBeams(agents, [handoff({ toId: 'a' })], 2000)).toEqual([])
  })
})

describe('computeBeams: shared files', () => {
  it('connects two agents in one project that touched the same file, with a write', () => {
    const a = agent('a', 'p1', [{ path: 'src/App.tsx', writes: 1, state: 'writing' }])
    const b = agent('b', 'p1', [{ path: 'src/App.tsx', reads: 2, state: 'reading' }])
    const beams = computeBeams([a, b], [], 0)
    expect(beams).toEqual([
      { key: 's:a|b', kind: 'shared', fromId: 'a', toId: 'b', files: ['src/App.tsx'], age: 0 },
    ])
  })

  it('does not connect agents that only read the same file', () => {
    const a = agent('a', 'p1', [{ path: 'README.md', reads: 3 }])
    const b = agent('b', 'p1', [{ path: 'README.md', reads: 1 }])
    expect(computeBeams([a, b], [], 0)).toEqual([])
  })

  it('does not connect agents in different projects', () => {
    const a = agent('a', 'p1', [{ path: 'x.go', writes: 1 }])
    const b = agent('b', 'p2', [{ path: 'x.go', writes: 1 }])
    expect(computeBeams([a, b], [], 0)).toEqual([])
  })

  it('lists every shared file on one beam, sorted', () => {
    const a = agent('a', 'p1', [
      { path: 'z.ts', writes: 1 },
      { path: 'a.ts', writes: 1 },
    ])
    const b = agent('b', 'p1', [
      { path: 'a.ts', reads: 1 },
      { path: 'z.ts', reads: 1 },
    ])
    const [beam] = computeBeams([a, b], [], 0)
    expect(beam.files).toEqual(['a.ts', 'z.ts'])
  })
})

describe('beamAlpha', () => {
  it('is full for live beams and fades finished handoffs linearly', () => {
    const live = computeBeams([agent('a'), agent('b')], [handoff()], 0)[0]
    expect(beamAlpha(live)).toBe(1)
    const done = { ...live, kind: 'handoff' as const, age: HANDOFF_FADE_MS / 2 }
    expect(beamAlpha(done)).toBeCloseTo(0.5)
  })
})
