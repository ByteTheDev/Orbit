import { describe, expect, it } from 'vitest'
import { computeLayout, orbitRate, planetPosition } from './layout'
import type { AgentSummary, ProjectSummary, Status } from '../../types'

const project = (id: string): ProjectSummary => ({ id, name: id, repoPath: id, createdAt: 1, agentCount: 0, runningCount: 0, conflicts: [], handoffs: [], conversations: [] })
const agent = (id: string, projectId: string, status: Status): AgentSummary =>
  ({ id, projectId, createdAt: 1, status } as unknown as AgentSummary)

describe('orbit rate by status', () => {
  it('runs working agents faster than idle ones, and failed agents slowest', () => {
    expect(orbitRate('thinking')).toBeGreaterThan(orbitRate('waiting'))
    expect(orbitRate('waiting')).toBeGreaterThan(orbitRate('completed'))
    expect(orbitRate('completed')).toBeGreaterThan(orbitRate('idle'))
    expect(orbitRate('idle')).toBeGreaterThan(orbitRate('failed'))
    for (const s of ['thinking', 'writing', 'reading', 'waiting', 'completed', 'idle', 'stopped', 'failed'] as Status[]) {
      expect(orbitRate(s)).toBeGreaterThan(0)
    }
  })
})

describe('live orbits', () => {
  it('does not move a planet when its status changes', () => {
    const before = computeLayout([project('p1')], [agent('a1', 'p1', 'idle')], new Map(), 10)
    const after = computeLayout([project('p1')], [agent('a1', 'p1', 'thinking')], new Map(), 10, before)
    const a = planetPosition(before.planetById.get('a1')!, 10)
    const b = planetPosition(after.planetById.get('a1')!, 10)
    expect(b.x).toBeCloseTo(a.x, 6)
    expect(b.y).toBeCloseTo(a.y, 6)
  })

  it('moves a planet at its new speed after a status change', () => {
    const before = computeLayout([project('p1')], [agent('a1', 'p1', 'idle')], new Map(), 10)
    const after = computeLayout([project('p1')], [agent('a1', 'p1', 'thinking')], new Map(), 10, before)
    expect(Math.abs(after.planetById.get('a1')!.speed)).toBeGreaterThan(Math.abs(before.planetById.get('a1')!.speed))
  })

  it('starts a planet from its default angle when there is no previous layout', () => {
    const fresh = computeLayout([project('p1')], [agent('a1', 'p1', 'thinking')], new Map(), 10)
    const carried = computeLayout([project('p1')], [agent('a1', 'p1', 'thinking')], new Map(), 10, fresh)
    expect(planetPosition(carried.planetById.get('a1')!, 12)).toEqual(planetPosition(fresh.planetById.get('a1')!, 12))
  })

  it('keeps orbiting after a dragged position is retained across agent updates', () => {
    const initial = computeLayout([project('p1')], [agent('a1', 'p1', 'thinking')], new Map(), 0)
    const sun = initial.sunById.get('p1')!
    const overrides = new Map([['a1', { x: sun.x + 300, y: sun.y }]])
    const dropped = computeLayout([project('p1')], [agent('a1', 'p1', 'thinking')], overrides, 1, initial)
    const before = planetPosition(dropped.planetById.get('a1')!, 5)
    const updated = computeLayout([project('p1')], [agent('a1', 'p1', 'thinking')], overrides, 5, dropped)
    const after = planetPosition(updated.planetById.get('a1')!, 5)
    expect(after.x).toBeCloseTo(before.x, 6)
    expect(after.y).toBeCloseTo(before.y, 6)
  })

  it('follows a new pointer position during a drag', () => {
    const initial = computeLayout([project('p1')], [agent('a1', 'p1', 'thinking')], new Map(), 0)
    const sun = initial.sunById.get('p1')!
    const pointer = { x: sun.x, y: sun.y + 300 }
    const dragged = computeLayout([project('p1')], [agent('a1', 'p1', 'thinking')], new Map([['a1', pointer]]), 5, initial, 'a1')
    const pos = planetPosition(dragged.planetById.get('a1')!, 5)
    expect(pos.x).toBeCloseTo(pointer.x, 6)
    expect(pos.y).toBeCloseTo(pointer.y, 6)
  })
})
