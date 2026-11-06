import { describe, expect, it } from 'vitest'
import { BASE_RADIUS, MIN_REACH, RING_GAP, computeLayout } from './layout'
import type { AgentSummary, ProjectSummary } from '../../types'

const project = (id: string): ProjectSummary => ({ id, name: id, repoPath: id, createdAt: 1, agentCount: 0, runningCount: 0, conflicts: [] })
const agent = (id: string, projectId: string): AgentSummary => ({ id, projectId, createdAt: Number(id.replace(/\D/g, '')) } as unknown as AgentSummary)

describe('universe reach', () => {
  it('gives an empty project the minimum disc', () => {
    const l = computeLayout([project('p1')], [], new Map(), 0)
    expect(l.suns[0].reach).toBe(MIN_REACH)
  })

  it('grows with the outermost orbit so every planet sits inside its universe', () => {
    const agents = [agent('a1', 'p1'), agent('a2', 'p1'), agent('a3', 'p1')]
    const l = computeLayout([project('p1')], agents, new Map(), 0)
    const outer = BASE_RADIUS + 2 * RING_GAP
    expect(l.suns[0].reach).toBeGreaterThanOrEqual(outer)
    for (const p of l.planets) expect(p.radius).toBeLessThan(l.suns[0].reach)
  })

  it('keeps each project’s reach independent of the others', () => {
    const l = computeLayout([project('p1'), project('p2')], [agent('a1', 'p1'), agent('a2', 'p1')], new Map(), 0)
    expect(l.suns[1].reach).toBe(MIN_REACH)
    expect(l.suns[0].reach).toBeGreaterThan(MIN_REACH)
  })
})

describe('scale', () => {
  it('lays out and hit-tests 30 projects and 300 agents within budget', async () => {
    const { hitTest } = await import('./render')
    const { fitPoints } = await import('./camera')
    const projs = Array.from({ length: 30 }, (_, i) => project(`proj-${i}`))
    const agents: AgentSummary[] = Array.from({ length: 300 }, (_, i) => ({
      ...agent(`agent-${i}`, `proj-${i % 30}`),
      recentFiles: [{ path: `f${i}.ts`, reads: 1, writes: 0, state: 'reading', lastOp: 'read', lastAt: 0 }],
    } as unknown as AgentSummary))

    let t = performance.now()
    const layout = computeLayout(projs, agents, new Map(), 0)
    expect(performance.now() - t).toBeLessThan(50)

    const agentMap = new Map(agents.map((a) => [a.id, a]))
    const projectMap = new Map(projs.map((p) => [p.id, p]))
    const cam = fitPoints(layout.suns.map((s) => ({ x: s.x, y: s.y })), 1200, 800, 140)
    const view = {
      width: 1200, height: 800, dpr: 1, camera: cam, layout, agents: agentMap, projects: projectMap,
      selectedId: null, hoverId: null, t: 0, now: 0, reduced: true, pulses: [], appearAt: new Map(),
    } as unknown as Parameters<typeof hitTest>[0]

    t = performance.now()
    for (let i = 0; i < 2000; i++) hitTest(view, (i * 37) % 1200, (i * 91) % 800)
    expect(performance.now() - t).toBeLessThan(400)
  })
})
