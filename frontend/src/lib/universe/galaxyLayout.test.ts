import { describe, expect, it } from 'vitest'
import { CORE_GAP, ORBIT_FLOOR_PX, ORBIT_GAP_PX, armAngle, computeLayout, displayOrbit, legacySunPosition, planetPosition, storedToWorld, sunPosition, worldToStored } from './layout'
import { MAX_ZOOM, MIN_ZOOM, clampZoom } from './camera'
import type { AgentSummary, ProjectSummary } from '../../types'

const project = (id: string): ProjectSummary => ({ id, name: id, repoPath: id, createdAt: 1, agentCount: 0, runningCount: 0, conflicts: [], handoffs: [], conversations: [] })
const agent = (id: string, projectId: string): AgentSummary => ({ id, projectId, createdAt: 1 } as unknown as AgentSummary)

describe('galactic formation', () => {
  it('keeps every sun outside the empty core', () => {
    for (let i = 0; i < 24; i++) {
      const p = sunPosition(i, `project-${i}`)
      expect(Math.hypot(p.x, p.y)).toBeGreaterThanOrEqual(CORE_GAP * 0.9)
    }
  })

  it('places suns on the two arms, so they sit close to a crest', () => {
    // The lateral spread is bounded, so every sun lies within a fraction of a radian of an arm.
    for (let i = 0; i < 24; i++) {
      const p = sunPosition(i, `project-${i}`)
      const r = Math.hypot(p.x, p.y)
      const theta = Math.atan2(p.y, p.x)
      const off = Math.min(...[0, 1].map((arm) => {
        const d = Math.abs(Math.atan2(Math.sin(theta - armAngle(r, arm)), Math.cos(theta - armAngle(r, arm))))
        return d
      }))
      expect(off).toBeLessThan(0.5)
    }
  })

  it('does not move a sun when other projects are added', () => {
    const a = sunPosition(3, 'stable')
    const b = sunPosition(3, 'stable')
    expect(a).toEqual(b)
  })
})

describe('overview legibility', () => {
  it('floors the drawn orbit at overview zoom, so a small system keeps its planets apart', () => {
    const agents = [agent('a1', 'p1'), agent('a2', 'p1'), agent('a3', 'p1')]
    const layout = computeLayout([project('p1')], agents, new Map(), 0)
    const zoom = 0.06
    const radii = layout.planets.map((p) => displayOrbit(p, zoom) * zoom).sort((x, y) => x - y)
    expect(radii[0]).toBeGreaterThanOrEqual(ORBIT_FLOOR_PX - 1e-9)
    for (let i = 1; i < radii.length; i++) expect(radii[i] - radii[i - 1]).toBeGreaterThanOrEqual(ORBIT_GAP_PX - 1e-6)
  })

  it('shows the true orbit once zoomed in', () => {
    const layout = computeLayout([project('p1')], [agent('a1', 'p1')], new Map(), 0)
    const p = layout.planets[0]
    expect(displayOrbit(p, 1)).toBe(p.radius)
    expect(planetPosition(p, 3, 1)).toEqual(planetPosition(p, 3))
  })

  it('ranks orbits by radius, so a dragged-in planet keeps the floor in order', () => {
    const agents = [agent('a1', 'p1'), agent('a2', 'p1')]
    // Drop the second planet inside the first orbit; it must still rank as the inner one.
    const sun = computeLayout([project('p1')], [], new Map(), 0).suns[0]
    const near = { x: sun.x + 130, y: sun.y }
    const far = { x: sun.x, y: sun.y + 400 }
    const layout = computeLayout([project('p1')], agents, new Map([['a1', far], ['a2', near]]), 0)
    const inner = layout.planetById.get('a2')!
    const outer = layout.planetById.get('a1')!
    expect(inner.rank).toBe(0)
    expect(outer.rank).toBe(1)
  })

  it('counts a system’s planets, for its halo', () => {
    const layout = computeLayout([project('p1'), project('p2')], [agent('a1', 'p1'), agent('a2', 'p1')], new Map(), 0)
    expect(layout.suns[0].planets).toBe(2)
    expect(layout.suns[1].planets).toBe(0)
  })
})

describe('zoom range', () => {
  it('lets a large galaxy zoom out far enough to fit on screen', () => {
    expect(MIN_ZOOM).toBeLessThanOrEqual(0.05)
    expect(clampZoom(0.001)).toBe(MIN_ZOOM)
    expect(clampZoom(10)).toBe(MAX_ZOOM)
  })
})

describe('saved positions', () => {
  it('keeps a saved planet on the same orbit after the suns move', () => {
    const agents = [agent('a1', 'p1'), agent('a2', 'p2')]
    // Saved in the legacy frame: each planet sits 200 units east of where its sun was first placed.
    const saved = (index: number, id: string) => {
      const was = legacySunPosition(index, id)
      return { x: was.x + 200, y: was.y }
    }
    const withPos = [{ ...agents[0], position: saved(0, 'p1') }, { ...agents[1], position: saved(1, 'p2') }] as AgentSummary[]
    const layout = computeLayout([project('p1'), project('p2')], withPos, new Map(), 0)
    for (const id of ['p1', 'p2']) {
      const sun = layout.sunById.get(id)!
      const planet = layout.planetById.get(id === 'p1' ? 'a1' : 'a2')!
      const at = planetPosition(planet, 0, Infinity)
      expect(Math.hypot(at.x - sun.x, at.y - sun.y)).toBeCloseTo(200, 6)
      expect(planet.radius).toBeCloseTo(200, 6)
    }
  })

  it('converts a dragged world point back to the saved frame and round-trips', () => {
    const sun = computeLayout([project('p1'), project('p2')], [], new Map(), 0).suns[1]
    const world = { x: sun.x + 50, y: sun.y - 30 }
    const stored = worldToStored(sun, world)
    const back = storedToWorld(sun, stored)
    expect(back.x).toBeCloseTo(world.x, 9)
    expect(back.y).toBeCloseTo(world.y, 9)
  })
})
