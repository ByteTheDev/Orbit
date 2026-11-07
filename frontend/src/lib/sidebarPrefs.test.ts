import { describe, expect, it } from 'vitest'
import { DEFAULT_SIDEBAR, SIDEBAR_MAX, SIDEBAR_MIN, clampSidebarWidth, loadSidebarPrefs, saveSidebarPrefs } from './sidebarPrefs'

function memory(initial?: string) {
  const data = new Map<string, string>(initial ? [['orbit.sidebar', initial]] : [])
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  }
}

describe('clampSidebarWidth', () => {
  it('keeps widths inside the allowed range', () => {
    expect(clampSidebarWidth(10)).toBe(SIDEBAR_MIN)
    expect(clampSidebarWidth(9999)).toBe(SIDEBAR_MAX)
    expect(clampSidebarWidth(300.4)).toBe(300)
  })

  it('falls back to the default for non-numbers', () => {
    expect(clampSidebarWidth(Number.NaN)).toBe(DEFAULT_SIDEBAR.width)
  })
})

describe('loadSidebarPrefs', () => {
  it('uses the defaults when nothing is saved', () => {
    expect(loadSidebarPrefs(memory())).toEqual(DEFAULT_SIDEBAR)
  })

  it('reads a saved width and collapsed state, clamping a stale width', () => {
    expect(loadSidebarPrefs(memory('{"width":360,"collapsed":true}'))).toEqual({ width: 360, collapsed: true })
    expect(loadSidebarPrefs(memory('{"width":9000}')).width).toBe(SIDEBAR_MAX)
  })

  it('ignores corrupt data rather than failing to start', () => {
    expect(loadSidebarPrefs(memory('{not json'))).toEqual(DEFAULT_SIDEBAR)
  })

  it('works without storage at all', () => {
    expect(loadSidebarPrefs(null)).toEqual(DEFAULT_SIDEBAR)
  })
})

describe('saveSidebarPrefs', () => {
  it('round-trips through storage', () => {
    const store = memory()
    saveSidebarPrefs({ width: 300, collapsed: true }, store)
    expect(loadSidebarPrefs(store)).toEqual({ width: 300, collapsed: true })
  })

  it('survives a storage that throws', () => {
    const broken = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('quota')
      },
    }
    expect(loadSidebarPrefs(broken)).toEqual(DEFAULT_SIDEBAR)
    expect(() => saveSidebarPrefs(DEFAULT_SIDEBAR, broken)).not.toThrow()
  })
})
