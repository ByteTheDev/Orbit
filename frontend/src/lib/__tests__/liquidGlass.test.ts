import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, THEMES, cssVarsFor, glassVarsFor, normaliseSettings, type Settings } from '../settings'

const palette = THEMES[0].palette
const solid = palette.sidebar

function vars(patch: Partial<Settings>) {
  return cssVarsFor({ ...DEFAULT_SETTINGS, ...patch })
}

describe('liquid glass settings', () => {
  it('defaults to glass on, 93% sidebar, balanced blur, and no forced solid surfaces', () => {
    expect(DEFAULT_SETTINGS.liquidGlass).toBe(true)
    expect(DEFAULT_SETTINGS.sidebarOpacity).toBe(93)
    expect(DEFAULT_SETTINGS.glassBlur).toBe('balanced')
    expect(DEFAULT_SETTINGS.mainPaneGlass).toBe(true)
    expect(DEFAULT_SETTINGS.secondaryGlass).toBe(true)
    expect(DEFAULT_SETTINGS.reduceTransparency).toBe(false)
  })

  it('clamps sidebar opacity to 5–100 and rounds it', () => {
    expect(normaliseSettings({ sidebarOpacity: 0 }).sidebarOpacity).toBe(5)
    expect(normaliseSettings({ sidebarOpacity: 5 }).sidebarOpacity).toBe(5)
    expect(normaliseSettings({ sidebarOpacity: 150 }).sidebarOpacity).toBe(100)
    expect(normaliseSettings({ sidebarOpacity: 88.6 }).sidebarOpacity).toBe(89)
    expect(normaliseSettings({ sidebarOpacity: '80' }).sidebarOpacity).toBe(93)
  })

  it('falls back to defaults for unknown blur levels and non-boolean switches', () => {
    const out = normaliseSettings({ glassBlur: 'extreme', liquidGlass: 'yes', mainPaneGlass: 0, reduceTransparency: 'true' })
    expect(out.glassBlur).toBe('balanced')
    expect(out.liquidGlass).toBe(true)
    expect(out.mainPaneGlass).toBe(true)
    expect(out.reduceTransparency).toBe(false)
  })

  it('allows the sidebar to be almost fully transparent', () => {
    expect(vars({ sidebarOpacity: 5 })['--glass-sidebar-bg']).toMatch(/ \/ 0\.05\)$/)
  })

  it('keeps valid saved values', () => {
    const out = normaliseSettings({ glassBlur: 'strong', sidebarOpacity: 75, liquidGlass: false, reduceTransparency: true })
    expect(out).toMatchObject({ glassBlur: 'strong', sidebarOpacity: 75, liquidGlass: false, reduceTransparency: true })
  })
})

describe('glassVarsFor', () => {
  it('makes the sidebar translucent at the chosen opacity, with the blur filter', () => {
    const v = vars({ sidebarOpacity: 93 })
    expect(v['--glass-sidebar-bg']).toMatch(/^rgb\(.+ \/ 0\.93\)$/)
    expect(v['--glass-sidebar-filter']).toBe('blur(16px) saturate(1.3)')
  })

  it('uses the blur radius for each level, and no filter for Off', () => {
    expect(vars({ glassBlur: 'subtle' })['--glass-sidebar-filter']).toBe('blur(8px) saturate(1.3)')
    expect(vars({ glassBlur: 'strong' })['--glass-sidebar-filter']).toBe('blur(26px) saturate(1.3)')
    expect(vars({ glassBlur: 'off' })['--glass-sidebar-filter']).toBe('none')
  })

  it('turns every glass surface solid when Liquid Glass is off', () => {
    const v = vars({ liquidGlass: false })
    expect(v['--glass-sidebar-bg']).toBe(solid)
    expect(v['--glass-main-bg']).toBe(solid)
    expect(v['--glass-popover-bg']).toBe(palette.popover)
    expect(v['--glass-inset-bg']).toBe(palette.surface)
    expect(v['--glass-sidebar-filter']).toBe('none')
    expect(v['--glass-main-filter']).toBe('none')
    expect(v['--glass-popover-filter']).toBe('none')
  })

  it('turns every glass surface solid when transparency is reduced, even with glass on', () => {
    const v = vars({ liquidGlass: true, reduceTransparency: true })
    expect(v['--glass-sidebar-bg']).toBe(solid)
    expect(v['--glass-popover-filter']).toBe('none')
  })

  it('leaves the main pane solid while its glass is off, and the sidebar still glass', () => {
    const v = vars({ mainPaneGlass: false })
    expect(v['--glass-main-bg']).toBe(solid)
    expect(v['--glass-main-filter']).toBe('none')
    expect(v['--glass-sidebar-filter']).not.toBe('none')
  })

  it('leaves secondary surfaces solid while their glass is off', () => {
    const v = vars({ secondaryGlass: false })
    expect(v['--glass-popover-bg']).toBe(palette.popover)
    expect(v['--glass-popover-filter']).toBe('none')
    expect(v['--glass-inset-bg']).toBe(palette.surface)
  })

  it('keeps a colour it cannot read as a solid colour, so nothing turns invisible', () => {
    const v = glassVarsFor({ ...DEFAULT_SETTINGS }, { ...palette, sidebar: 'hsl(0 0% 5%)' })
    expect(v['--glass-sidebar-bg']).toBe('hsl(0 0% 5%)')
  })
})
