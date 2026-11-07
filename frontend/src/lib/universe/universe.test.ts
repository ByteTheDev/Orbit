import { describe, expect, it } from 'vitest'
import { fitPoints, screenToWorld, worldToScreen, zoomAt } from './camera'
import { BASE_RADIUS, CELL, computeLayout, planetPosition } from './layout'
import type { AgentSummary, ProjectSummary } from '../../types'

const cam = { x: 120, y: -40, zoom: 0.8 }

describe('camera', () => {
  it('converts between world and screen coordinates', () => {
    const s = worldToScreen(cam, 800, 600, 300, 50)
    const w = screenToWorld(cam, 800, 600, s.x, s.y)
    expect(w.x).toBeCloseTo(300)
    expect(w.y).toBeCloseTo(50)
  })

  it('keeps the point under the cursor fixed while zooming', () => {
    const before = screenToWorld(cam, 800, 600, 250, 180)
    const next = zoomAt(cam, 800, 600, 250, 180, 1.7)
    const after = screenToWorld(next, 800, 600, 250, 180)
    expect(after.x).toBeCloseTo(before.x)
    expect(after.y).toBeCloseTo(before.y)
    expect(next.zoom).toBeCloseTo(cam.zoom * 1.7)
  })

  it('fits every point inside the viewport', () => {
    const points = [{ x: -500, y: 0 }, { x: 900, y: 400 }]
    const c = fitPoints(points, 1000, 700)
    for (const p of points) {
      const s = worldToScreen(c, 1000, 700, p.x, p.y)
      expect(s.x).toBeGreaterThanOrEqual(0)
      expect(s.x).toBeLessThanOrEqual(1000)
      expect(s.y).toBeGreaterThanOrEqual(0)
      expect(s.y).toBeLessThanOrEqual(700)
    }
  })
})

const projects: ProjectSummary[] = [
  { id: 'p1', name: 'One', repoPath: 'a', createdAt: 1, agentCount: 2, runningCount: 0, conflicts: [], handoffs: [], conversations: [] },
  { id: 'p2', name: 'Two', repoPath: 'b', createdAt: 2, agentCount: 0, runningCount: 0, conflicts: [], handoffs: [], conversations: [] },
  { id: 'p3', name: 'Three', repoPath: 'c', createdAt: 3, agentCount: 0, runningCount: 0, conflicts: [], handoffs: [], conversations: [] },
]
const agentStub = (id: string, projectId: string, position?: { x: number; y: number }): AgentSummary =>
  ({ id, projectId, position, createdAt: Number(id.replace(/\D/g, '')) } as unknown as AgentSummary)

describe('layout', () => {
  it('places suns on a spiral that does not depend on agents', () => {
    const a = computeLayout(projects, [], new Map(), 0)
    const b = computeLayout(projects, [agentStub('a1', 'p1')], new Map(), 0)
    expect(a.suns.map((s) => [s.x, s.y])).toEqual(b.suns.map((s) => [s.x, s.y]))
    // Suns stay apart: no pair closer than most of a cell.
    for (let i = 0; i < a.suns.length; i++) {
      for (let j = i + 1; j < a.suns.length; j++) {
        expect(Math.hypot(a.suns[i].x - a.suns[j].x, a.suns[i].y - a.suns[j].y)).toBeGreaterThan(CELL * 0.8)
      }
    }
  })

  it('spaces planets on increasing orbits within a system', () => {
    const l = computeLayout(projects, [agentStub('a1', 'p1'), agentStub('a2', 'p1')], new Map(), 0)
    expect(l.planetById.get('a1')!.radius).toBe(BASE_RADIUS)
    expect(l.planetById.get('a2')!.radius).toBeGreaterThan(BASE_RADIUS)
  })

  it('keeps a dragged planet where it was dropped at the reference time', () => {
    // A live drag is a world point, passed through overrides. Saved positions are tested separately.
    const drop = { x: 0 + 300, y: 0 + 0 }
    const l = computeLayout(projects, [agentStub('a1', 'p1')], new Map([['a1', drop]]), 5)
    const p = planetPosition(l.planetById.get('a1')!, 5)
    expect(p.x).toBeCloseTo(drop.x, 3)
    expect(p.y).toBeCloseTo(drop.y, 3)
  })
})
