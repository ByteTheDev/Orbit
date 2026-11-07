import { describe, expect, it } from 'vitest'
import {
  ACCENTS,
  DEFAULT_SETTINGS,
  THEMES,
  applySettings,
  cssVarsFor,
  hexToRgbTriplet,
  isValidColour,
  loadCustomThemes,
  loadSettings,
  normaliseSettings,
  parseThemeFile,
  resolveReducedMotion,
  saveCustomThemes,
  saveSettings,
  type ThemeInfo,
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

  it('sets the type scale factor so the text tokens resize with the setting', () => {
    expect(cssVarsFor(DEFAULT_SETTINGS)['--text-scale']).toBe('1')
    expect(Number(cssVarsFor({ ...DEFAULT_SETTINGS, textSize: 'xlarge' })['--text-scale'])).toBeCloseTo(15 / 13)
    expect(Number(cssVarsFor({ ...DEFAULT_SETTINGS, textSize: 'small' })['--text-scale'])).toBeCloseTo(12 / 13)
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

describe('built-in themes', () => {
  it('have unique ids and only valid colours', () => {
    const ids = THEMES.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const t of THEMES) {
      expect(t.id.startsWith('custom-')).toBe(false)
      for (const value of Object.values(t.palette)) expect(isValidColour(value)).toBe(true)
    }
  })

  it('has a good number of choices', () => {
    expect(THEMES.length).toBeGreaterThanOrEqual(20)
  })
})

describe('parseThemeFile', () => {
  const good = JSON.stringify({ name: 'Ocean', palette: { canvas: '#041018', ink: '#e6f4ff' } })

  it('builds a theme from a minimal file, filling the rest from Orbit', () => {
    const r = parseThemeFile(good, 255)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.theme.name).toBe('Ocean')
    expect(r.theme.blurb).toBe('Custom theme')
    expect(r.theme.id.startsWith('custom-ocean-')).toBe(true)
    expect(r.theme.palette.canvas).toBe('#041018')
    expect(r.theme.palette.ink).toBe('#e6f4ff')
    expect(r.theme.palette.sidebar).toBe(THEMES[0].palette.sidebar)
  })

  it('starts from a named base theme', () => {
    const r = parseThemeFile(JSON.stringify({ name: 'X', base: 'nord', palette: { ink: '#ffffff' } }))
    if (!r.ok) throw new Error(r.error)
    expect(r.theme.palette.surface).toBe(THEMES.find((t) => t.id === 'nord')!.palette.surface)
  })

  it('derives the dividers from a changed border', () => {
    const r = parseThemeFile(JSON.stringify({ name: 'X', palette: { border: '#ff8000' } }))
    if (!r.ok) throw new Error(r.error)
    expect(r.theme.palette.line).toBe('rgb(255 128 0 / 0.6)')
    expect(r.theme.palette.lineStrong).toBe('rgb(255 128 0 / 0.9)')
  })

  it('rejects bad input with a message the user can act on', () => {
    const cases: [string, RegExp][] = [
      ['{not json', /not valid JSON/],
      ['[]', /JSON object/],
      [JSON.stringify({ palette: { canvas: '#000' } }), /"name"/],
      [JSON.stringify({ name: 'x'.repeat(41), palette: {} }), /40 characters/],
      [JSON.stringify({ name: 'X' }), /"palette" object/],
      [JSON.stringify({ name: 'X', base: 'neon', palette: {} }), /"base"/],
      [JSON.stringify({ name: 'X', palette: { suface: '#000' } }), /Unknown colour "suface"/],
      [JSON.stringify({ name: 'X', palette: { canvas: 'red' } }), /"canvas" must be a colour/],
      [JSON.stringify({ name: 'X', palette: { canvas: 'url(javascript:alert(1))' } }), /"canvas" must be a colour/],
    ]
    for (const [text, message] of cases) {
      const r = parseThemeFile(text)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error).toMatch(message)
    }
  })

  it('accepts hex with alpha and rgb()/rgba()', () => {
    expect(isValidColour('#1e1e2e80')).toBe(true)
    expect(isValidColour('rgba(30, 30, 46, 0.5)')).toBe(true)
    expect(isValidColour('rgb(30 30 46 / 50%)')).toBe(true)
    expect(isValidColour('#12')).toBe(false)
    expect(isValidColour('hsl(0 0% 0%)')).toBe(false)
  })
})

describe('custom theme storage', () => {
  const good = JSON.stringify({ name: 'Ocean', palette: { canvas: '#041018' } })
  // A fixed clock, so the generated id is the same on every call.
  const sample = (): ThemeInfo => {
    const r = parseThemeFile(good, 255)
    if (!r.ok) throw new Error(r.error)
    return r.theme
  }

  it('round-trips imported themes', () => {
    const store = memory()
    saveCustomThemes([sample()], store)
    expect(loadCustomThemes(store)).toEqual([sample()])
  })

  it('drops malformed entries instead of failing', () => {
    const store = memory()
    store.setItem('orbit.customThemes', JSON.stringify([{ id: 'custom-a' }, 'nope', sample()]))
    expect(loadCustomThemes(store)).toEqual([sample()])
    store.setItem('orbit.customThemes', '{oops')
    expect(loadCustomThemes(store)).toEqual([])
  })

  it('accepts a custom theme id in settings only while that theme exists', () => {
    const id = sample().id
    expect(normaliseSettings({ theme: id }).theme).toBe('orbit')
    expect(normaliseSettings({ theme: id }, [id]).theme).toBe(id)
  })

  it('uses an imported theme’s colours in the CSS', () => {
    const t = sample()
    expect(cssVarsFor({ ...DEFAULT_SETTINGS, theme: t.id }, [t])['--color-canvas']).toBe('#041018')
    expect(cssVarsFor({ ...DEFAULT_SETTINGS, theme: t.id }, [])['--color-canvas']).toBe(THEMES[0].palette.canvas)
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
