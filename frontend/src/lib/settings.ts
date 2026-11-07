// User settings: appearance, behaviour and keyboard. Kept apart from the store so the
// defaults, validation and CSS application can be tested without a browser or React.
//
// Settings are per-machine UI preferences, so they live in localStorage, not the Go state file.

import { normaliseDefaultModels, type DefaultModels } from './defaultModel'

/** A built-in theme id, or the id of an imported theme (those start with `custom-`). */
export type ThemeId = string
export type AccentId = 'neutral' | 'claude' | 'blue' | 'teal' | 'violet' | 'amber' | 'rose' | 'green'
export type TextSize = 'small' | 'default' | 'large' | 'xlarge'
export type MotionSetting = 'system' | 'reduce' | 'full'
export type ToastLength = 'short' | 'normal' | 'long'

export interface Settings {
  theme: ThemeId
  accent: AccentId
  textSize: TextSize
  motion: MotionSetting
  /** Enter sends a chat message. When off, Enter inserts a line and Ctrl/⌘+Enter sends. */
  enterToSend: boolean
  /** Single-key shortcuts (N, P, D, 1–6 …). Off leaves Alt+arrows and the mouse. */
  singleKeyShortcuts: boolean
  toastLength: ToastLength
  /** The model a new agent starts with, per provider id. A provider with no entry uses its own default. */
  defaultModels: DefaultModels
  /** Liquid Glass: translucent, blurred panels. Off makes every surface solid. */
  liquidGlass: boolean
  /** How much of the galaxy shows through the sidebar, as a percentage. 100 is solid. */
  sidebarOpacity: number
  glassBlur: GlassBlur
  /** Glass on the agent workspace (the inspector) as well as the sidebar. */
  mainPaneGlass: boolean
  /** Glass on menus, pickers, dialogs, tooltips, cards and floating controls. */
  secondaryGlass: boolean
  /** Replaces translucent surfaces with solid ones and removes blur. Also set by the OS "reduce transparency" option. */
  reduceTransparency: boolean
}

export type GlassBlur = 'off' | 'subtle' | 'balanced' | 'strong'

/** Blur radius for each Glass blur setting. */
export const GLASS_BLUR_PX: Record<GlassBlur, number> = { off: 0, subtle: 8, balanced: 16, strong: 26 }

/** The sidebar opacity range. 5 is almost fully transparent: only the frost and the edge remain. */
export const SIDEBAR_OPACITY_RANGE = { min: 5, max: 100, default: 93 } as const

export const DEFAULT_SETTINGS: Settings = {
  theme: 'orbit',
  accent: 'neutral',
  textSize: 'default',
  motion: 'system',
  enterToSend: true,
  singleKeyShortcuts: true,
  toastLength: 'normal',
  defaultModels: {},
  liquidGlass: true,
  sidebarOpacity: SIDEBAR_OPACITY_RANGE.default,
  glassBlur: 'balanced',
  mainPaneGlass: true,
  secondaryGlass: true,
  reduceTransparency: false,
}

/** Surface and text tokens a theme may override. Status and provider colours never change. */
export interface ThemePalette {
  canvas: string
  sidebar: string
  surface: string
  popover: string
  hover: string
  border: string
  /** Translucent border used for dividers. */
  line: string
  lineStrong: string
  ink: string
  muted: string
  faint: string
}

export interface ThemeInfo {
  id: ThemeId
  name: string
  blurb: string
  palette: ThemePalette
}

const PALETTE_KEYS: readonly (keyof ThemePalette)[] = [
  'canvas',
  'sidebar',
  'surface',
  'popover',
  'hover',
  'border',
  'line',
  'lineStrong',
  'ink',
  'muted',
  'faint',
]

/** A colour with alpha, as CSS `rgb()`. Null when the colour is not a 6-digit hex. */
function withAlpha(hex: string, alpha: number): string | null {
  const triplet = hexToRgbTriplet(hex)
  return triplet ? `rgb(${triplet} / ${alpha})` : null
}

// Orbit's own palette, copied from index.css @theme. Presets below only change surfaces and text.
const ORBIT: ThemePalette = {
  canvas: '#09090b',
  sidebar: '#0d0d0f',
  surface: '#141416',
  popover: '#18181b',
  hover: '#1c1c20',
  border: '#27272a',
  line: 'rgb(39 39 42 / 0.6)',
  lineStrong: 'rgb(63 63 70 / 0.9)',
  ink: '#f4f4f5',
  muted: '#a1a1aa',
  faint: '#71717a',
}

export const THEMES: ThemeInfo[] = [
  { id: 'orbit', name: 'Orbit', blurb: 'The original near-black, neutral grey.', palette: ORBIT },
  preset('light', 'Light', 'Bright neutral surfaces with dark text.', {
    canvas: '#fafafa',
    sidebar: '#f4f4f5',
    surface: '#ffffff',
    popover: '#ffffff',
    hover: '#ececef',
    border: '#e4e4e7',
    ink: '#18181b',
    muted: '#52525b',
    faint: '#71717a',
  }),
  {
    id: 'midnight',
    name: 'Midnight',
    blurb: 'Deep navy with a cool blue cast.',
    palette: {
      ...ORBIT,
      canvas: '#050914',
      sidebar: '#070e1e',
      surface: '#0c1629',
      popover: '#101d35',
      hover: '#14233f',
      border: '#1e2d4a',
      line: 'rgb(30 45 74 / 0.6)',
      lineStrong: 'rgb(50 70 106 / 0.9)',
    },
  },
  {
    id: 'aurora',
    name: 'Aurora',
    blurb: 'Dark spruce with a teal tint.',
    palette: {
      ...ORBIT,
      canvas: '#040e0d',
      sidebar: '#06150f',
      surface: '#0b1f1a',
      popover: '#0f2823',
      hover: '#132f29',
      border: '#1d3b35',
      line: 'rgb(29 59 53 / 0.6)',
      lineStrong: 'rgb(48 84 76 / 0.9)',
    },
  },
  {
    id: 'nebula',
    name: 'Nebula',
    blurb: 'Violet-black, for a deep-space feel.',
    palette: {
      ...ORBIT,
      canvas: '#08060f',
      sidebar: '#0c0918',
      surface: '#140f26',
      popover: '#1a1433',
      hover: '#211a3f',
      border: '#2d2552',
      line: 'rgb(45 37 82 / 0.6)',
      lineStrong: 'rgb(68 58 112 / 0.9)',
    },
  },
  {
    id: 'ember',
    name: 'Ember',
    blurb: 'Warm brown-black, easy on the eyes at night.',
    palette: {
      ...ORBIT,
      canvas: '#110907',
      sidebar: '#160c09',
      surface: '#1f130e',
      popover: '#261811',
      hover: '#2e1f16',
      border: '#3d2a20',
      line: 'rgb(61 42 32 / 0.6)',
      lineStrong: 'rgb(90 64 50 / 0.9)',
      muted: '#b5a49a',
      faint: '#86766c',
    },
  },
  {
    id: 'contrast',
    name: 'High contrast',
    blurb: 'Pure black, stronger borders and brighter text.',
    palette: {
      canvas: '#000000',
      sidebar: '#000000',
      surface: '#0a0a0a',
      popover: '#111111',
      hover: '#1a1a1a',
      border: '#5c5c66',
      line: 'rgb(92 92 102 / 0.8)',
      lineStrong: 'rgb(161 161 170 / 0.9)',
      ink: '#ffffff',
      muted: '#d4d4d8',
      faint: '#a1a1aa',
    },
  },
  preset('graphite', 'Graphite', 'Flat, cool grey with no tint.', {
    canvas: '#0e0e10',
    sidebar: '#121214',
    surface: '#19191c',
    popover: '#202024',
    hover: '#26262b',
    border: '#33333a',
    ink: '#ececef',
    muted: '#9a9aa3',
    faint: '#6b6b74',
  }),
  preset('forest', 'Forest', 'Deep green, quiet and earthy.', {
    canvas: '#0a120c',
    sidebar: '#0d1810',
    surface: '#13221a',
    popover: '#182b20',
    hover: '#1d3327',
    border: '#29473a',
    ink: '#e4f0e6',
    muted: '#9fb8a6',
    faint: '#6f8a79',
  }),
  preset('crimson', 'Crimson', 'Oxblood black with a red edge.', {
    canvas: '#120708',
    sidebar: '#190a0c',
    surface: '#220e11',
    popover: '#2b1217',
    hover: '#34161c',
    border: '#4a2029',
    ink: '#f7e6e8',
    muted: '#c4a0a6',
    faint: '#8c6a70',
  }),
  preset('synthwave', 'Synthwave', 'Purple night with a retro glow.', {
    canvas: '#13081f',
    sidebar: '#180a28',
    surface: '#20103a',
    popover: '#29134a',
    hover: '#33195c',
    border: '#4b2a7a',
    ink: '#f5e9ff',
    muted: '#c3a6e0',
    faint: '#8a6fa6',
  }),
  preset('matrix', 'Matrix', 'Black with green phosphor text.', {
    canvas: '#000800',
    sidebar: '#010c02',
    surface: '#021405',
    popover: '#051c08',
    hover: '#082610',
    border: '#103d18',
    ink: '#b8ffc2',
    muted: '#6fcf7f',
    faint: '#3f7f4d',
  }),
  preset('dracula', 'Dracula', 'Purple-grey, inspired by the popular editor scheme.', {
    canvas: '#282a36',
    sidebar: '#21222c',
    surface: '#303341',
    popover: '#343746',
    hover: '#3c3f52',
    border: '#44475a',
    ink: '#f8f8f2',
    muted: '#bfc3d9',
    faint: '#6272a4',
  }),
  preset('nord', 'Nord', 'Arctic blue-grey.', {
    canvas: '#2e3440',
    sidebar: '#272c36',
    surface: '#3b4252',
    popover: '#434c5e',
    hover: '#4c566a',
    border: '#4c566a',
    ink: '#eceff4',
    muted: '#d8dee9',
    faint: '#7b88a1',
  }),
  preset('tokyo-night', 'Tokyo Night', 'Deep indigo with soft blue text.', {
    canvas: '#1a1b26',
    sidebar: '#16161e',
    surface: '#1f2335',
    popover: '#24283b',
    hover: '#292e42',
    border: '#3b4261',
    ink: '#c0caf5',
    muted: '#9aa5ce',
    faint: '#565f89',
  }),
  preset('gruvbox', 'Gruvbox', 'Retro warm charcoal and cream.', {
    canvas: '#282828',
    sidebar: '#1d2021',
    surface: '#32302f',
    popover: '#3c3836',
    hover: '#45403d',
    border: '#504945',
    ink: '#ebdbb2',
    muted: '#bdae93',
    faint: '#928374',
  }),
  preset('solarized-dark', 'Solarized Dark', 'Teal-tinted, low glare.', {
    canvas: '#002b36',
    sidebar: '#00212b',
    surface: '#073642',
    popover: '#0b4150',
    hover: '#124b5a',
    border: '#1f5664',
    ink: '#eee8d5',
    muted: '#93a1a1',
    faint: '#7d9296',
  }),
  preset('monokai', 'Monokai', 'Olive-black with warm off-white text.', {
    canvas: '#272822',
    sidebar: '#1e1f1c',
    surface: '#2f302a',
    popover: '#383930',
    hover: '#41423a',
    border: '#49483e',
    ink: '#f8f8f2',
    muted: '#cfcfc2',
    faint: '#908f80',
  }),
  preset('one-dark', 'One Dark', 'Slate blue-grey, calm and even.', {
    canvas: '#282c34',
    sidebar: '#21252b',
    surface: '#2c313a',
    popover: '#323842',
    hover: '#3a404c',
    border: '#3e4451',
    ink: '#d7dae0',
    muted: '#9da5b4',
    faint: '#636d83',
  }),
  preset('catppuccin-mocha', 'Catppuccin Mocha', 'Soft lavender-tinted dark.', {
    canvas: '#1e1e2e',
    sidebar: '#181825',
    surface: '#262637',
    popover: '#313244',
    hover: '#3a3b50',
    border: '#45475a',
    ink: '#cdd6f4',
    muted: '#a6adc8',
    faint: '#7f849c',
  }),
  preset('rose-pine', 'Rosé Pine', 'Muted plum and rose.', {
    canvas: '#191724',
    sidebar: '#1f1d2e',
    surface: '#26233a',
    popover: '#2a2741',
    hover: '#332f4a',
    border: '#403d52',
    ink: '#e0def4',
    muted: '#908caa',
    faint: '#6e6a86',
  }),
]

/** Builds a built-in theme. Dividers are derived from the border so each preset only lists its colours. */
function preset(id: string, name: string, blurb: string, surfaces: Omit<ThemePalette, 'line' | 'lineStrong'>): ThemeInfo {
  return {
    id,
    name,
    blurb,
    palette: {
      ...surfaces,
      line: withAlpha(surfaces.border, 0.6) ?? 'rgb(39 39 42 / 0.6)',
      lineStrong: withAlpha(surfaces.border, 0.9) ?? 'rgb(63 63 70 / 0.9)',
    },
  }
}

export const ACCENTS: { id: AccentId; name: string; color: string }[] = [
  { id: 'neutral', name: 'Neutral', color: '#f4f4f5' },
  { id: 'claude', name: 'Terracotta', color: '#d97757' },
  { id: 'blue', name: 'Blue', color: '#60a5fa' },
  { id: 'teal', name: 'Teal', color: '#2dd4bf' },
  { id: 'violet', name: 'Violet', color: '#a78bfa' },
  { id: 'amber', name: 'Amber', color: '#fbbf24' },
  { id: 'rose', name: 'Rose', color: '#fb7185' },
  { id: 'green', name: 'Green', color: '#4ade80' },
]

/** The px size the type scale in index.css is designed at. The default text size matches it. */
export const TEXT_BASE_PX = 13

export const TEXT_SIZES: Record<TextSize, { label: string; px: number }> = {
  small: { label: 'Small', px: 12 },
  default: { label: 'Default', px: 13 },
  large: { label: 'Large', px: 14 },
  xlarge: { label: 'Extra large', px: 15 },
}

export const TOAST_MS: Record<ToastLength, number> = { short: 1800, normal: 3200, long: 6000 }

// ---- validation -----------------------------------------------------------------------

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback
}

const THEME_IDS = THEMES.map((t) => t.id)
const ACCENT_IDS = ACCENTS.map((a) => a.id)

/**
 * Fills in anything missing or invalid from the defaults. Unknown keys are dropped.
 * `customIds` are the ids of imported themes that currently exist; a theme id outside both lists is replaced.
 */
export function normaliseSettings(raw: unknown, customIds: readonly string[] = []): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    theme: pick(r.theme, [...THEME_IDS, ...customIds], DEFAULT_SETTINGS.theme),
    accent: pick(r.accent, ACCENT_IDS, DEFAULT_SETTINGS.accent),
    textSize: pick(r.textSize, ['small', 'default', 'large', 'xlarge'] as const, DEFAULT_SETTINGS.textSize),
    motion: pick(r.motion, ['system', 'reduce', 'full'] as const, DEFAULT_SETTINGS.motion),
    enterToSend: typeof r.enterToSend === 'boolean' ? r.enterToSend : DEFAULT_SETTINGS.enterToSend,
    singleKeyShortcuts:
      typeof r.singleKeyShortcuts === 'boolean' ? r.singleKeyShortcuts : DEFAULT_SETTINGS.singleKeyShortcuts,
    toastLength: pick(r.toastLength, ['short', 'normal', 'long'] as const, DEFAULT_SETTINGS.toastLength),
    defaultModels: normaliseDefaultModels(r.defaultModels),
    liquidGlass: typeof r.liquidGlass === 'boolean' ? r.liquidGlass : DEFAULT_SETTINGS.liquidGlass,
    sidebarOpacity:
      typeof r.sidebarOpacity === 'number' && Number.isFinite(r.sidebarOpacity)
        ? Math.min(SIDEBAR_OPACITY_RANGE.max, Math.max(SIDEBAR_OPACITY_RANGE.min, Math.round(r.sidebarOpacity)))
        : DEFAULT_SETTINGS.sidebarOpacity,
    glassBlur: pick(r.glassBlur, ['off', 'subtle', 'balanced', 'strong'] as const, DEFAULT_SETTINGS.glassBlur),
    mainPaneGlass: typeof r.mainPaneGlass === 'boolean' ? r.mainPaneGlass : DEFAULT_SETTINGS.mainPaneGlass,
    secondaryGlass: typeof r.secondaryGlass === 'boolean' ? r.secondaryGlass : DEFAULT_SETTINGS.secondaryGlass,
    reduceTransparency: typeof r.reduceTransparency === 'boolean' ? r.reduceTransparency : DEFAULT_SETTINGS.reduceTransparency,
  }
}

// ---- persistence ----------------------------------------------------------------------

const KEY = 'orbit.settings'

type KeyValueStore = Pick<Storage, 'getItem' | 'setItem'>

function defaultStorage(): KeyValueStore | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null
  } catch {
    // Some embedded browsers throw on access when storage is disabled.
    return null
  }
}

/** Reads saved settings. Anything missing or malformed gives the defaults, never an error. */
export function loadSettings(storage: KeyValueStore | null = defaultStorage()): Settings {
  if (!storage) return { ...DEFAULT_SETTINGS }
  try {
    const raw = storage.getItem(KEY)
    return raw ? normaliseSettings(JSON.parse(raw), loadCustomThemes(storage).map((t) => t.id)) : { ...DEFAULT_SETTINGS }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

/** Saves settings. A failed write is ignored: the change still applies, it just forgets on restart. */
export function saveSettings(settings: Settings, storage: KeyValueStore | null = defaultStorage()): void {
  if (!storage) return
  try {
    storage.setItem(KEY, JSON.stringify(settings))
  } catch {
    // Quota or access errors are not worth interrupting the user for.
  }
}

// ---- custom themes ----------------------------------------------------------------------

const CUSTOM_KEY = 'orbit.customThemes'
export const MAX_CUSTOM_THEMES = 50
/** Largest theme file the import accepts. A real theme is a few hundred bytes. */
export const MAX_THEME_FILE_BYTES = 64 * 1024

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** A CSS colour the theme may use: a hex colour, or rgb()/rgba() with plain numbers. Nothing else, so a file cannot inject CSS. */
const HEX_COLOUR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i
const RGB_COLOUR = /^rgba?\(\s*[\d.\s,%/]+\)$/i
export function isValidColour(v: unknown): v is string {
  return typeof v === 'string' && v.length <= 64 && (HEX_COLOUR.test(v) || RGB_COLOUR.test(v))
}

/** Checks one stored custom theme. Anything malformed is dropped rather than breaking the app. */
function storedTheme(raw: unknown): ThemeInfo | null {
  if (!isRecord(raw) || typeof raw.id !== 'string' || !raw.id.startsWith('custom-')) return null
  if (typeof raw.name !== 'string' || typeof raw.blurb !== 'string' || !isRecord(raw.palette)) return null
  const palette = {} as ThemePalette
  for (const key of PALETTE_KEYS) {
    const value = raw.palette[key]
    if (!isValidColour(value)) return null
    palette[key] = value
  }
  return { id: raw.id, name: raw.name, blurb: raw.blurb, palette }
}

/** Reads imported themes. Missing or malformed data gives an empty list. */
export function loadCustomThemes(storage: KeyValueStore | null = defaultStorage()): ThemeInfo[] {
  if (!storage) return []
  try {
    const raw = storage.getItem(CUSTOM_KEY)
    const list: unknown = raw ? JSON.parse(raw) : []
    if (!Array.isArray(list)) return []
    return list
      .map(storedTheme)
      .filter((t): t is ThemeInfo => t !== null)
      .slice(0, MAX_CUSTOM_THEMES)
  } catch {
    return []
  }
}

/** Saves imported themes. A failed write is ignored, like saveSettings. */
export function saveCustomThemes(themes: readonly ThemeInfo[], storage: KeyValueStore | null = defaultStorage()): void {
  if (!storage) return
  try {
    storage.setItem(CUSTOM_KEY, JSON.stringify(themes.slice(0, MAX_CUSTOM_THEMES)))
  } catch {
    // Quota or access errors are not worth interrupting the user for.
  }
}

export type ThemeParseResult = { ok: true; theme: ThemeInfo } | { ok: false; error: string }

/**
 * Turns the text of a theme file into a theme. The format:
 *
 *   {
 *     "name": "My theme",            required, up to 40 characters
 *     "blurb": "A short note",       optional
 *     "base": "orbit",               optional built-in theme to start from (default "orbit")
 *     "palette": { "canvas": "#101010", ... }   required; any of the surface keys, all optional
 *   }
 *
 * Colours not given come from `base`. Dividers come from the border unless given. Pure, so it can be tested.
 */
export function parseThemeFile(text: string, now: number = Date.now()): ThemeParseResult {
  const fail = (error: string): ThemeParseResult => ({ ok: false, error })
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return fail('That file is not valid JSON.')
  }
  if (!isRecord(data)) return fail('A theme file must be a JSON object.')

  const name = typeof data.name === 'string' ? data.name.trim() : ''
  if (!name) return fail('The theme needs a "name".')
  if (name.length > 40) return fail('The theme name must be 40 characters or fewer.')

  if (data.blurb !== undefined && typeof data.blurb !== 'string') return fail('"blurb" must be text.')
  const blurb = typeof data.blurb === 'string' && data.blurb.trim() ? data.blurb.trim().slice(0, 120) : 'Custom theme'

  const baseId = data.base === undefined ? 'orbit' : data.base
  const base = typeof baseId === 'string' ? THEMES.find((t) => t.id === baseId) : undefined
  if (!base) return fail(`"base" must name a built-in theme, such as "orbit" or "nord".`)

  if (!isRecord(data.palette)) return fail('The theme needs a "palette" object.')
  const given = data.palette
  for (const key of Object.keys(given)) {
    if (!(PALETTE_KEYS as readonly string[]).includes(key)) return fail(`Unknown colour "${key}" in the palette.`)
    if (!isValidColour(given[key])) return fail(`"${key}" must be a colour such as #1e1e2e or rgb(30 30 46).`)
  }

  const palette: ThemePalette = { ...base.palette }
  for (const key of PALETTE_KEYS) {
    const value = given[key]
    if (typeof value === 'string') palette[key] = value
  }
  // Dividers follow a changed border unless the file sets them.
  if (given.line === undefined && given.border !== undefined) palette.line = withAlpha(palette.border, 0.6) ?? palette.line
  if (given.lineStrong === undefined && given.border !== undefined) {
    palette.lineStrong = withAlpha(palette.border, 0.9) ?? palette.lineStrong
  }

  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'theme'
  return { ok: true, theme: { id: `custom-${slug}-${now.toString(36)}`, name, blurb, palette } }
}

/** A short example for the Settings page, so people know what to write. */
export const THEME_FILE_EXAMPLE = `{
  "name": "Ocean",
  "base": "midnight",
  "palette": {
    "canvas": "#041018",
    "surface": "#0a1d2a",
    "ink": "#e6f4ff",
    "muted": "#9cc3d9"
  }
}`

// ---- derived values -------------------------------------------------------------------

/** Whether motion should rest. An explicit choice wins over the OS setting. */
export function resolveReducedMotion(motion: MotionSetting, systemReduced: boolean): boolean {
  if (motion === 'reduce') return true
  if (motion === 'full') return false
  return systemReduced
}

/** '#rrggbb' to 'r g b', for CSS rgb() with an alpha channel. Returns null for anything else. */
export function hexToRgbTriplet(hex: string): string | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!m) return null
  const n = parseInt(m[1], 16)
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`
}

/**
 * True when a palette's canvas is light (any theme, built-in or imported). Light themes flip the tint
 * token to black and make the neutral accent the ink colour, so overlays and selection stay visible.
 */
export function isLightPalette(p: ThemePalette): boolean {
  const triplet = hexToRgbTriplet(p.canvas)
  if (!triplet) return false
  const [r, g, b] = triplet.split(' ').map(Number)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 140
}

/** The theme a settings object selects, falling back to the first built-in. */
export function themeFor(settings: Settings, customThemes: readonly ThemeInfo[] = []): ThemeInfo {
  return [...THEMES, ...customThemes].find((t) => t.id === settings.theme) ?? THEMES[0]
}

/** The CSS custom properties a settings object implies. Pure, so it can be tested. */
export function cssVarsFor(settings: Settings, customThemes: readonly ThemeInfo[] = []): Record<string, string> {
  const p = themeFor(settings, customThemes).palette
  const light = isLightPalette(p)
  const vars: Record<string, string> = {
    // Overlays and hairlines are drawn in this colour: white on dark themes, black on light ones.
    '--color-tint': light ? '#000000' : '#ffffff',
    '--color-canvas': p.canvas,
    '--color-sidebar': p.sidebar,
    '--color-surface': p.surface,
    '--color-popover': p.popover,
    '--color-hover': p.hover,
    '--color-border': p.border,
    '--color-line': p.line,
    '--color-line-strong': p.lineStrong,
    '--color-ink': p.ink,
    '--color-muted': p.muted,
    '--color-faint': p.faint,
    '--ui-font-size': `${TEXT_SIZES[settings.textSize].px}px`,
    // The type scale in index.css multiplies each step by this, so every text-label/caption/body/title is resized.
    '--text-scale': String(TEXT_SIZES[settings.textSize].px / TEXT_BASE_PX),
  }
  const accent = ACCENTS.find((a) => a.id === settings.accent) ?? ACCENTS[0]
  // "Neutral" is near-white, which vanishes on a light canvas, so it follows the ink there.
  const accentColour = accent.id === 'neutral' && light ? p.ink : accent.color
  const rgb = hexToRgbTriplet(accentColour)
  vars['--color-accent'] = accentColour
  vars['--color-focus'] = rgb ? `rgb(${rgb} / 0.55)` : 'rgb(244 244 245 / 0.55)'
  Object.assign(vars, glassVarsFor(settings, p))
  return vars
}

/** A palette colour at a given opacity. A colour it cannot read (not #rrggbb) stays solid, so nothing turns invisible. */
function glassAlpha(hex: string, alpha: number): string {
  const triplet = hexToRgbTriplet(hex)
  return triplet ? `rgb(${triplet} / ${alpha})` : hex
}

/**
 * The Liquid Glass variables. Each glass class in index.css reads one background and one blur
 * variable, so a setting change restyles every panel at once. With glass off, reduced, or a surface
 * excluded, its background is the solid palette colour and it has no blur.
 */
export function glassVarsFor(settings: Settings, p: ThemePalette): Record<string, string> {
  const on = settings.liquidGlass && !settings.reduceTransparency
  const blur = GLASS_BLUR_PX[settings.glassBlur]
  const filter = (active: boolean) => (on && active && blur > 0 ? `blur(${blur}px) saturate(1.3)` : 'none')
  const sheen = isLightPalette(p) ? '0 0 0' : '255 255 255'
  return {
    '--glass-sidebar-bg': on ? glassAlpha(p.sidebar, settings.sidebarOpacity / 100) : p.sidebar,
    '--glass-sidebar-filter': filter(true),
    '--glass-main-bg': on && settings.mainPaneGlass ? glassAlpha(p.sidebar, 0.86) : p.sidebar,
    '--glass-main-filter': filter(settings.mainPaneGlass),
    '--glass-popover-bg': on && settings.secondaryGlass ? glassAlpha(p.popover, 0.9) : p.popover,
    '--glass-popover-filter': filter(settings.secondaryGlass),
    '--glass-inset-bg': on && settings.secondaryGlass ? glassAlpha(p.surface, 0.55) : p.surface,
    // A faint frost sheen so glass still reads as glass when the tint is nearly transparent.
    '--glass-sheen': on ? `linear-gradient(rgb(${sheen} / 0.05), rgb(${sheen} / 0.012))` : 'none',
  }
}

/**
 * Writes settings to the document. Safe to call repeatedly. Does nothing without a document (tests).
 * Variables are set on the root, so every component that reads the @theme tokens picks them up.
 */
export function applySettings(
  settings: Settings,
  reducedMotion: boolean,
  root: HTMLElement | null = typeof document !== 'undefined' ? document.documentElement : null,
  customThemes: readonly ThemeInfo[] = [],
): void {
  if (!root) return
  for (const [name, value] of Object.entries(cssVarsFor(settings, customThemes))) root.style.setProperty(name, value)
  // Native scrollbars, form controls and the default text colour follow the theme's brightness.
  root.style.colorScheme = isLightPalette(themeFor(settings, customThemes).palette) ? 'light' : 'dark'
  root.dataset.theme = settings.theme
  root.dataset.accent = settings.accent
  // index.css reads this, so a user's "reduce motion" also stills CSS animations, not only the galaxy.
  root.dataset.reducedMotion = reducedMotion ? 'true' : 'false'
}
