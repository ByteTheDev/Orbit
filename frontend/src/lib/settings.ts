// User settings: appearance, behaviour and keyboard. Kept apart from the store so the
// defaults, validation and CSS application can be tested without a browser or React.
//
// Settings are per-machine UI preferences, so they live in localStorage, not the Go state file.

export type ThemeId = 'orbit' | 'midnight' | 'aurora' | 'nebula' | 'ember' | 'contrast'
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
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'orbit',
  accent: 'neutral',
  textSize: 'default',
  motion: 'system',
  enterToSend: true,
  singleKeyShortcuts: true,
  toastLength: 'normal',
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
]

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

/** Fills in anything missing or invalid from the defaults. Unknown keys are dropped. */
export function normaliseSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    theme: pick(r.theme, THEME_IDS, DEFAULT_SETTINGS.theme),
    accent: pick(r.accent, ACCENT_IDS, DEFAULT_SETTINGS.accent),
    textSize: pick(r.textSize, ['small', 'default', 'large', 'xlarge'] as const, DEFAULT_SETTINGS.textSize),
    motion: pick(r.motion, ['system', 'reduce', 'full'] as const, DEFAULT_SETTINGS.motion),
    enterToSend: typeof r.enterToSend === 'boolean' ? r.enterToSend : DEFAULT_SETTINGS.enterToSend,
    singleKeyShortcuts:
      typeof r.singleKeyShortcuts === 'boolean' ? r.singleKeyShortcuts : DEFAULT_SETTINGS.singleKeyShortcuts,
    toastLength: pick(r.toastLength, ['short', 'normal', 'long'] as const, DEFAULT_SETTINGS.toastLength),
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
    return raw ? normaliseSettings(JSON.parse(raw)) : { ...DEFAULT_SETTINGS }
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

/** The CSS custom properties a settings object implies. Pure, so it can be tested. */
export function cssVarsFor(settings: Settings): Record<string, string> {
  const theme = THEMES.find((t) => t.id === settings.theme) ?? THEMES[0]
  const p = theme.palette
  const vars: Record<string, string> = {
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
  }
  const accent = ACCENTS.find((a) => a.id === settings.accent) ?? ACCENTS[0]
  const rgb = hexToRgbTriplet(accent.color)
  vars['--color-accent'] = accent.color
  vars['--color-focus'] = rgb ? `rgb(${rgb} / 0.55)` : 'rgb(244 244 245 / 0.55)'
  return vars
}

/**
 * Writes settings to the document. Safe to call repeatedly. Does nothing without a document (tests).
 * Variables are set on the root, so every component that reads the @theme tokens picks them up.
 */
export function applySettings(
  settings: Settings,
  reducedMotion: boolean,
  root: HTMLElement | null = typeof document !== 'undefined' ? document.documentElement : null,
): void {
  if (!root) return
  for (const [name, value] of Object.entries(cssVarsFor(settings))) root.style.setProperty(name, value)
  root.dataset.theme = settings.theme
  root.dataset.accent = settings.accent
  // index.css reads this, so a user's "reduce motion" also stills CSS animations, not only the galaxy.
  root.dataset.reducedMotion = reducedMotion ? 'true' : 'false'
}
