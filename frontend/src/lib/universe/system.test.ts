import { describe, expect, it } from 'vitest'
import { fitPoints, worldToScreen } from './camera'
import { computeLayout, systemBounds } from './layout'
import type { AgentSummary, ProjectSummary } from '../../types'

const project = (id: string): ProjectSummary => ({ id, name: id, repoPath: id, createdAt: 1, agentCount: 0, runningCount: 0, conflicts: [], handoffs: [], conversations: [] })
const agent = (id: string, projectId: string): AgentSummary => ({ id, projectId, createdAt: 1 } as unknown as AgentSummary)

describe('system framing', () => {
  it('centres the camera on the star and keeps the whole system on screen', () => {
    const agents = [agent('a1', 'p2'), agent('a2', 'p2'), agent('a3', 'p2')]
    const layout = computeLayout([project('p1'), project('p2')], agents, new Map(), 0)
    const sun = layout.sunById.get('p2')!
    const w = 1200
    const h = 800
    const cam = fitPoints(systemBounds(sun), w, h, 90)

    expect(cam.x).toBeCloseTo(sun.x, 6)
    expect(cam.y).toBeCloseTo(sun.y, 6)
    for (const p of layout.planets.filter((p) => p.projectId === 'p2')) {
      const s = worldToScreen(cam, w, h, p.sunX + p.radius, p.sunY)
      expect(s.x).toBeGreaterThanOrEqual(0)
      expect(s.x).toBeLessThanOrEqual(w)
    }
    const edge = worldToScreen(cam, w, h, sun.x + sun.reach, sun.y)
    expect(edge.x).toBeLessThanOrEqual(w)
    expect(edge.x).toBeGreaterThanOrEqual(0)
  })
})
