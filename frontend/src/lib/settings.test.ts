import { describe, expect, it } from 'vitest'
import {
  ACCENTS,
  DEFAULT_SETTINGS,
  THEMES,
  applySettings,
  cssVarsFor,
  hexToRgbTriplet,
  loadSettings,
  normaliseSettings,
  resolveReducedMotion,
  saveSettings,
} from './settings'

function memory(initial?: string) {
  const data = new Map<string, string>(initial ? [['orbit.settings', initial]] : [])
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  }
}

describe('normaliseSettings', () => {
  it('returns the defaults for nothing, null or non-objects', () => {
    expect(normaliseSettings(undefined)).toEqual(DEFAULT_SETTINGS)
    expect(normaliseSettings(null)).toEqual(DEFAULT_SETTINGS)
    expect(normaliseSettings('dark')).toEqual(DEFAULT_SETTINGS)
  })

  it('keeps valid values and drops unknown keys', () => {
    const out = normaliseSettings({ theme: 'nebula', accent: 'teal', enterToSend: false, extra: 1 })
    expect(out.theme).toBe('nebula')
    expect(out.accent).toBe('teal')
    expect(out.enterToSend).toBe(false)
    expect(out).not.toHaveProperty('extra')
  })

  it('replaces invalid enum values and wrong-typed booleans with defaults', () => {
    const out = normaliseSettings({ theme: 'neon', accent: 42, textSize: 'huge', motion: 'none', singleKeyShortcuts: 'yes', toastLength: 'forever' })
    expect(out).toEqual(DEFAULT_SETTINGS)
  })
})

describe('loadSettings / saveSettings', () => {
  it('round-trips through storage', () => {
    const store = memory()
    const s = { ...DEFAULT_SETTINGS, theme: 'ember' as const, textSize: 'large' as const }
    saveSettings(s, store)
    expect(loadSettings(store)).toEqual(s)
  })

  it('falls back to defaults on corrupt JSON', () => {
    expect(loadSettings(memory('{not json'))).toEqual(DEFAULT_SETTINGS)
  })

  it('works without storage at all', () => {
    expect(loadSettings(null)).toEqual(DEFAULT_SETTINGS)
    expect(() => saveSettings(DEFAULT_SETTINGS, null)).not.toThrow()
  })

  it('ignores a storage that throws on write', () => {
    const broken = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota')
      },
    }
    expect(() => saveSettings(DEFAULT_SETTINGS, broken)).not.toThrow()
  })
})

describe('resolveReducedMotion', () => {
  it('lets an explicit choice win over the OS setting', () => {
    expect(resolveReducedMotion('reduce', false)).toBe(true)
    expect(resolveReducedMotion('full', true)).toBe(false)
  })

  it('follows the OS when set to system', () => {
    expect(resolveReducedMotion('system', true)).toBe(true)
    expect(resolveReducedMotion('system', false)).toBe(false)
  })
})

describe('cssVarsFor', () => {
  it('uses the chosen theme surfaces', () => {
    const vars = cssVarsFor({ ...DEFAULT_SETTINGS, theme: 'midnight' })
    const midnight = THEMES.find((t) => t.id === 'midnight')!.palette
    expect(vars['--color-canvas']).toBe(midnight.canvas)
    expect(vars['--color-surface']).toBe(midnight.surface)
  })

  it('leaves the neutral accent as the original white', () => {
    const vars = cssVarsFor(DEFAULT_SETTINGS)
    expect(vars['--color-accent']).toBe('#f4f4f5')
    expect(vars['--color-focus']).toBe('rgb(244 244 245 / 0.55)')
  })

  it('derives the focus ring from a coloured accent', () => {
    const vars = cssVarsFor({ ...DEFAULT_SETTINGS, accent: 'blue' })
    expect(vars['--color-accent']).toBe('#60a5fa')
    expect(vars['--color-focus']).toBe('rgb(96 165 250 / 0.55)')
  })

  it('maps text size to the base font size', () => {
    expect(cssVarsFor({ ...DEFAULT_SETTINGS, textSize: 'xlarge' })['--ui-font-size']).toBe('15px')
    expect(cssVarsFor(DEFAULT_SETTINGS)['--ui-font-size']).toBe('13px')
  })

  it('never touches status or provider colours', () => {
    const keys = Object.keys(cssVarsFor({ ...DEFAULT_SETTINGS, theme: 'contrast', accent: 'rose' }))
    expect(keys.some((k) => k.includes('status') || k.includes('claude') || k.includes('codex'))).toBe(false)
  })
})

describe('hexToRgbTriplet', () => {
  it('converts 6-digit hex and rejects anything else', () => {
    expect(hexToRgbTriplet('#ff8000')).toBe('255 128 0')
    expect(hexToRgbTriplet('#FFF')).toBeNull()
    expect(hexToRgbTriplet('red')).toBeNull()
  })

  it('has a valid triplet for every accent', () => {
    for (const a of ACCENTS) expect(hexToRgbTriplet(a.color)).not.toBeNull()
  })
})

describe('applySettings', () => {
  it('writes variables and data attributes onto a root element', () => {
    const props = new Map<string, string>()
    const root = {
      style: { setProperty: (k: string, v: string) => void props.set(k, v) },
      dataset: {} as Record<string, string>,
    } as unknown as HTMLElement
    applySettings({ ...DEFAULT_SETTINGS, theme: 'aurora', accent: 'amber' }, true, root)
    expect(props.get('--color-canvas')).toBe(THEMES.find((t) => t.id === 'aurora')!.palette.canvas)
    expect(props.get('--color-accent')).toBe('#fbbf24')
    expect((root.dataset as Record<string, string>).theme).toBe('aurora')
    expect((root.dataset as Record<string, string>).reducedMotion).toBe('true')
  })

  it('does nothing without a root element', () => {
    expect(() => applySettings(DEFAULT_SETTINGS, false, null)).not.toThrow()
  })
})
