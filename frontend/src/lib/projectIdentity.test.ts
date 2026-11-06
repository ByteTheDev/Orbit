import { describe, expect, it } from 'vitest'
import { ACCENTS, GLYPHS, identityFor } from './projectIdentity'

describe('identityFor', () => {
  it('is stable for the same id', () => {
    expect(identityFor('project-abc')).toEqual(identityFor('project-abc'))
  })

  it('always picks a listed accent and a real glyph', () => {
    for (let i = 0; i < 200; i++) {
      const id = identityFor(`p-${i}`)
      expect(ACCENTS).toContain(id.accent)
      expect(Object.values(GLYPHS)).toContain(id.glyphPath)
    }
  })

  it('spreads projects across accents and symbols rather than repeating one', () => {
    const ids = Array.from({ length: 12 }, (_, i) => identityFor(`project-${i}`))
    expect(new Set(ids.map((i) => i.accent)).size).toBeGreaterThanOrEqual(5)
    expect(new Set(ids.map((i) => i.glyph)).size).toBeGreaterThanOrEqual(5)
  })
})
