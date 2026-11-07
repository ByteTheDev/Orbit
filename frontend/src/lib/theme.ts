import type { Status } from '../types'
import claudeLogo from '../assets/providers/claude.png'
import codexLogo from '../assets/providers/codex.png'
import fxLogo from '../assets/providers/fx.png'
import ompLogo from '../assets/providers/omp.png'
import opencodeLogo from '../assets/providers/opencode.png'
import piLogo from '../assets/providers/pi.png'

/**
 * Status and provider colours. The source of truth is the `@theme` block in index.css;
 * this module reads those variables once so the canvas and the DOM always agree.
 * Fallbacks match index.css and only apply where there is no document (tests).
 */
function token(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback
  const value = getComputedStyle(document.documentElement).getPropertyValue(`--color-${name}`).trim()
  return value || fallback
}

export const STATUS_COLOR: Record<Status, string> = {
  idle: token('status-idle', '#71717a'),
  thinking: token('status-thinking', '#fde047'),
  writing: token('status-writing', '#60a5fa'),
  reading: token('status-reading', '#2dd4bf'),
  waiting: token('status-waiting', '#e4e4e7'),
  completed: token('status-completed', '#4ade80'),
  failed: token('status-failed', '#f87171'),
  stopped: token('status-stopped', '#8a8a93'),
}

export const STATUS_LABEL: Record<Status, string> = {
  idle: 'Idle',
  thinking: 'Thinking',
  writing: 'Writing',
  reading: 'Reading',
  waiting: 'Waiting',
  completed: 'Completed',
  failed: 'Failed',
  stopped: 'Stopped',
}

export interface PlanetBody {
  base: string
  glow: string
  /** Single-letter fallback, used when there is no logo. */
  mark: string
  /** URL of the provider's real brand image (PNG in src/assets/providers). Drawn as the mark when present. */
  logo?: string
  /** Colour of the single-letter fallback. Dark by default; set it where the body is dark enough to need a light letter. */
  logoInk?: string
}

// Fallback body for a provider with no entry in PROVIDER_BODY. Neutral grey.
export const DEFAULT_BODY: PlanetBody = { base: '#52525b', glow: '#a1a1aa', mark: '?' }

// Body colour of a planet, by provider.
export const PROVIDER_BODY: Record<string, PlanetBody> = {
  claude: { base: token('claude', '#d97757'), glow: token('claude-glow', '#e0825c'), mark: 'C', logo: claudeLogo, logoInk: '#ffffff' },
  codex: { base: token('codex', '#e4e4e7'), glow: token('codex-glow', '#ffffff'), mark: 'X', logo: codexLogo },
  omp: { base: '#a65af0', glow: '#df9cff', mark: 'π', logo: ompLogo },
  pi: { base: '#141413', glow: '#52525b', mark: 'π', logo: piLogo },
  opencode: { base: '#d4d4d4', glow: '#ffffff', mark: 'O', logo: opencodeLogo },
  fx: { base: '#000000', glow: '#52525b', mark: 'f', logo: fxLogo },
}

// Sun colours. Muted and warm, so the suns read as light sources without competing with planets.
// Stars are drawn from spectral classes, so each project has its own identity:
// blue-white, pale gold, yellow, orange, red. Muted, so none of them reads as neon.
export const STAR_PALETTE = ['#cfdcff', '#f3e3b5', '#f2c76e', '#e89a5c', '#d96e55']

/** @deprecated Kept so existing imports keep working. Use STAR_PALETTE or starColorFor. */
export const SUN_PALETTE = STAR_PALETTE

/** A project's star colour. Stable for a given id, so a star never changes class when others come and go. */
export function starColorFor(projectId: string): string {
  let h = 2166136261
  for (let i = 0; i < projectId.length; i++) {
    h ^= projectId.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return STAR_PALETTE[(h >>> 0) % STAR_PALETTE.length]
}
