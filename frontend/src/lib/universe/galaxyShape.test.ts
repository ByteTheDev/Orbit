import { describe, expect, it } from 'vitest'
import { armStrength, buildGalaxyField, galacticDensity, galaxyFade, sampleCoreStars, sampleFieldStars } from './galaxyShape'

const seeded = (seed: number) => {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return (s >>> 0) / 4294967296
  }
}

describe('galactic density', () => {
  it('keeps arm strength between 0 and 1', () => {
    for (let i = 0; i < 500; i++) {
      const a = armStrength(Math.cos(i) * (i * 30), Math.sin(i) * (i * 30), 0, 0)
      expect(a).toBeGreaterThanOrEqual(0)
      expect(a).toBeLessThanOrEqual(1)
    }
  })

  it('bridges neighbouring suns: the space between them is denser than empty space beside them', () => {
    const suns = [{ x: 0, y: 0 }, { x: 2600, y: 0 }]
    const cx = 1300
    const cy = 0
    const between = galacticDensity(1300, 0, suns, cx, cy, 8000)
    const far = galacticDensity(1300, 6000, suns, cx, cy, 8000)
    expect(between).toBeGreaterThan(far * 2)
  })

  it('rasterises a field centred on the galactic core at the origin, with values in [0, 1]', () => {
    const suns = [{ x: 0, y: 0 }, { x: 2600, y: 1000 }, { x: -1800, y: 2200 }]
    const f = buildGalaxyField(suns)
    expect(f.cells.length).toBe(f.size * f.size)
    // The core stays where the layout keeps its empty bulge, not at the centroid of the suns.
    expect(f.cx).toBe(0)
    expect(f.cy).toBe(0)
    for (const v of f.cells) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
  })

  it('handles an empty workspace: a faint spiral around the origin and no suns', () => {
    const f = buildGalaxyField([])
    expect(f.cx).toBe(0)
    expect(f.cy).toBe(0)
    expect(Math.max(...f.cells)).toBeGreaterThan(0)
  })
})

describe('sampling', () => {
  it('places sampled stars inside the field, and deterministically for a seed', () => {
    const f = buildGalaxyField([{ x: 0, y: 0 }, { x: 2600, y: 0 }])
    const a = sampleFieldStars(f, 200, seeded(7))
    const b = sampleFieldStars(f, 200, seeded(7))
    expect(a).toEqual(b)
    for (const s of a) {
      expect(Math.abs(s.x - f.cx)).toBeLessThanOrEqual(f.half)
      expect(Math.abs(s.y - f.cy)).toBeLessThanOrEqual(f.half)
    }
  })

  it('clusters the core around the galactic centre', () => {
    const f = buildGalaxyField([{ x: 0, y: 0 }, { x: 2600, y: 0 }])
    const core = sampleCoreStars(f, 400, seeded(3))
    const near = core.filter((s) => Math.hypot(s.x - f.cx, s.y - f.cy) < 1200).length
    expect(near / core.length).toBeGreaterThan(0.9)
  })
})

describe('zoom fade', () => {
  it('shows the galaxy fully when zoomed out and gives way as the camera enters a system', () => {
    expect(galaxyFade(0.3)).toBe(1)
    expect(galaxyFade(1.2)).toBeLessThan(1)
    expect(galaxyFade(2.6)).toBeGreaterThan(0)
    expect(galaxyFade(2.6)).toBeLessThan(galaxyFade(1.2))
  })
})
