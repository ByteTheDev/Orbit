import { describe, expect, it } from 'vitest'
import { carryOverSettings, filterModels, groupModels, type SearchableModel } from '../modelSearch'

const models: SearchableModel[] = [
  { id: 'claude-opus-5-5', label: 'Opus 5.5', group: 'Flagship', description: 'Deepest reasoning' },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', group: 'Balanced', description: 'Fast and capable' },
  { id: 'claude-haiku-5-5', label: 'Haiku 5.5', group: 'Balanced', description: 'Quickest responses' },
  { id: 'claude-fable-5-1', label: 'Fable 5.1', group: 'Flagship', description: 'Long-horizon work' },
]

describe('filterModels', () => {
  it('keeps everything, in order, for an empty or blank query', () => {
    expect(filterModels(models, '')).toEqual(models)
    expect(filterModels(models, '   ')).toEqual(models)
  })

  it('matches label, id, group and description, ignoring case', () => {
    expect(filterModels(models, 'OPUS').map((m) => m.id)).toEqual(['claude-opus-5-5'])
    expect(filterModels(models, 'fable-5-1').map((m) => m.id)).toEqual(['claude-fable-5-1'])
    expect(filterModels(models, 'balanced').map((m) => m.id)).toEqual(['claude-sonnet-5-5', 'claude-haiku-5-5'])
    expect(filterModels(models, 'reasoning').map((m) => m.id)).toEqual(['claude-opus-5-5'])
  })

  it('requires every word of the query to match', () => {
    expect(filterModels(models, 'haiku quickest').map((m) => m.id)).toEqual(['claude-haiku-5-5'])
    expect(filterModels(models, 'haiku deepest')).toEqual([])
  })

  it('returns an empty list when nothing matches', () => {
    expect(filterModels(models, 'gpt')).toEqual([])
  })
})

describe('groupModels', () => {
  it('groups by name, keeping the order each group first appears', () => {
    const groups = groupModels(models)
    expect(groups.map((g) => g.group)).toEqual(['Flagship', 'Balanced'])
    expect(groups[0].items.map((m) => m.id)).toEqual(['claude-opus-5-5', 'claude-fable-5-1'])
    expect(groups[1].items.map((m) => m.id)).toEqual(['claude-sonnet-5-5', 'claude-haiku-5-5'])
  })

  it('returns no groups for no models', () => {
    expect(groupModels([])).toEqual([])
  })
})

describe('carryOverSettings', () => {
  const think = { effort: ['low', 'high'], fastMode: false }

  it('keeps a thinking level the new model offers', () => {
    expect(carryOverSettings(think, 'high', false)).toEqual({ effort: 'high', fast: false, ultra: false })
  })

  it('drops a thinking level the new model does not offer', () => {
    expect(carryOverSettings(think, 'max', false)).toEqual({ effort: '', fast: false, ultra: false })
  })

  it('keeps fast mode only on a model that supports it', () => {
    expect(carryOverSettings({ effort: [], fastMode: true }, '', true)).toEqual({ effort: '', fast: true, ultra: false })
    expect(carryOverSettings({ effort: [], fastMode: false }, '', true)).toEqual({ effort: '', fast: false, ultra: false })
  })

  it('clears everything for the provider default', () => {
    expect(carryOverSettings(undefined, 'high', true)).toEqual({ effort: '', fast: false, ultra: false })
  })
})
