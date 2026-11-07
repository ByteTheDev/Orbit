import { describe, expect, it } from 'vitest'
import { defaultModelFor, normaliseDefaultModels, withDefaultModel } from '../defaultModel'

describe('normaliseDefaultModels', () => {
  it('keeps non-empty strings and trims them', () => {
    expect(normaliseDefaultModels({ claude: ' claude-opus-5-5 ', codex: '', pi: 3, omp: null })).toEqual({ claude: 'claude-opus-5-5' })
  })

  it('ignores anything that is not an object', () => {
    expect(normaliseDefaultModels(undefined)).toEqual({})
    expect(normaliseDefaultModels('claude')).toEqual({})
    expect(normaliseDefaultModels(['claude'])).toEqual({})
  })
})

describe('defaultModelFor', () => {
  const offered = [{ id: 'claude-opus-5-5' }, { id: 'claude-sonnet-5-5' }]

  it('uses the saved model when the provider still offers it', () => {
    expect(defaultModelFor({ claude: 'claude-sonnet-5-5' }, 'claude', offered)).toBe('claude-sonnet-5-5')
  })

  it('falls back to the provider default when the model is no longer offered or nothing is saved', () => {
    expect(defaultModelFor({ claude: 'claude-retired' }, 'claude', offered)).toBe('')
    expect(defaultModelFor({}, 'claude', offered)).toBe('')
  })
})

describe('withDefaultModel', () => {
  it('sets, replaces and clears one provider without touching the others, and does not mutate the input', () => {
    const start = { claude: 'a', codex: 'b' }
    expect(withDefaultModel(start, 'claude', 'c')).toEqual({ claude: 'c', codex: 'b' })
    expect(withDefaultModel(start, 'claude', '')).toEqual({ codex: 'b' })
    expect(start).toEqual({ claude: 'a', codex: 'b' })
  })
})
