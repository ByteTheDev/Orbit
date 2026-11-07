import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, THEMES, applySettings, cssVarsFor, isLightPalette, themeFor, type Settings } from '../settings'

const light = THEMES.find((t) => t.id === 'light')!

describe('light theme', () => {
  it('ships as a built-in theme with a light canvas', () => {
    expect(light).toBeDefined()
    expect(isLightPalette(light.palette)).toBe(true)
  })

  it('leaves every dark built-in theme dark', () => {
    for (const t of THEMES.filter((t) => t.id !== 'light')) expect(isLightPalette(t.palette), t.id).toBe(false)
  })

  it('flips the tint to black on light themes and keeps it white on dark ones', () => {
    const tint = (theme: string) => cssVarsFor({ ...DEFAULT_SETTINGS, theme }, [])['--color-tint']
    expect(tint('light')).toBe('#000000')
    expect(tint('orbit')).toBe('#ffffff')
  })

  it('makes the neutral accent the ink colour on light themes only', () => {
    const neutral = (theme: string, accent: Settings['accent'] = 'neutral') =>
      cssVarsFor({ ...DEFAULT_SETTINGS, theme, accent }, [])['--color-accent']
    expect(neutral('light')).toBe(light.palette.ink)
    expect(neutral('orbit')).toBe('#f4f4f5')
    expect(neutral('light', 'blue')).toBe('#60a5fa')
  })

  it('treats an imported light theme as light, from its canvas', () => {
    const custom = { id: 'custom-paper', name: 'Paper', blurb: 'Custom', palette: { ...light.palette } }
    const settings = { ...DEFAULT_SETTINGS, theme: 'custom-paper' }
    expect(themeFor(settings, [custom]).id).toBe('custom-paper')
    expect(cssVarsFor(settings, [custom])['--color-tint']).toBe('#000000')
  })

  it('does not call a canvas it cannot read as hex light', () => {
    expect(isLightPalette({ ...light.palette, canvas: 'rgb(250 250 250)' })).toBe(false)
  })

  it('sets the native colour scheme to match the theme brightness', () => {
    const root = { style: { setProperty: vi.fn(), colorScheme: '' }, dataset: {} as Record<string, string> }
    applySettings({ ...DEFAULT_SETTINGS, theme: 'light' }, false, root as unknown as HTMLElement, [])
    expect(root.style.colorScheme).toBe('light')
    applySettings({ ...DEFAULT_SETTINGS, theme: 'orbit' }, false, root as unknown as HTMLElement, [])
    expect(root.style.colorScheme).toBe('dark')
  })
})
