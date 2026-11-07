import { describe, expect, it } from 'vitest'
import { effortTone } from '../effort'

describe('effortTone', () => {
  it('gives Ultra the purple border, on any provider', () => {
    expect(effortTone('ultra', 'codex')).toBe('effort-ultra')
    expect(effortTone('ultra', 'claude')).toBe('effort-ultra')
  })

  it('gives Claude max the rainbow border only on Claude', () => {
    expect(effortTone('max', 'claude')).toBe('effort-rainbow')
    expect(effortTone('max', 'codex')).toBe('')
  })

  it('leaves every other level, and no level, untoned', () => {
    expect(effortTone('high', 'claude')).toBe('')
    expect(effortTone('', 'claude')).toBe('')
  })
})
