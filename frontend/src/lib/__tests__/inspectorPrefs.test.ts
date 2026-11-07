import { describe, expect, it } from 'vitest'
import { INSPECTOR_DEFAULT, INSPECTOR_MAX, INSPECTOR_MIN, clampInspectorWidth, loadInspectorWidth, saveInspectorWidth } from '../inspectorPrefs'

function memory(initial: string | null = null) {
  let value = initial
  return {
    getItem: () => value,
    setItem: (_k: string, v: string) => {
      value = v
    },
    read: () => value,
  }
}

describe('clampInspectorWidth', () => {
  it('keeps widths inside the allowed range and rounds them', () => {
    expect(clampInspectorWidth(100)).toBe(INSPECTOR_MIN)
    expect(clampInspectorWidth(9999)).toBe(INSPECTOR_MAX)
    expect(clampInspectorWidth(450.6)).toBe(451)
  })

  it('falls back to the default for non-numbers', () => {
    expect(clampInspectorWidth(Number.NaN)).toBe(INSPECTOR_DEFAULT)
    expect(clampInspectorWidth(Number.POSITIVE_INFINITY)).toBe(INSPECTOR_DEFAULT)
  })
})

describe('loadInspectorWidth', () => {
  it('returns the default when nothing is saved or storage is unavailable', () => {
    expect(loadInspectorWidth(memory())).toBe(INSPECTOR_DEFAULT)
    expect(loadInspectorWidth(null)).toBe(INSPECTOR_DEFAULT)
  })

  it('ignores malformed data', () => {
    expect(loadInspectorWidth(memory('not json'))).toBe(INSPECTOR_DEFAULT)
    expect(loadInspectorWidth(memory('{"width":"wide"}'))).toBe(INSPECTOR_DEFAULT)
  })

  it('clamps a saved width that is out of range', () => {
    expect(loadInspectorWidth(memory('{"width":5000}'))).toBe(INSPECTOR_MAX)
  })
})

describe('saveInspectorWidth', () => {
  it('round-trips a width through storage', () => {
    const store = memory()
    saveInspectorWidth(540, store)
    expect(loadInspectorWidth(store)).toBe(540)
  })

  it('clamps before saving', () => {
    const store = memory()
    saveInspectorWidth(10, store)
    expect(store.read()).toBe(`{"width":${INSPECTOR_MIN}}`)
  })
})
