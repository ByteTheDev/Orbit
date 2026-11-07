import type { Status } from '../types'

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
  /** SVG path data in a 24×24 box. Drawn as the provider's brand mark when present. */
  logo?: string
  /** Fill rule for the logo path, when the mark needs evenodd. */
  logoRule?: 'nonzero' | 'evenodd'
}

/** Anthropic's mark (the "A"), in a 24×24 box. */
const ANTHROPIC_LOGO =
  'M17.3041 3.541h-3.6718l6.696 16.918H24Zm-10.6082 0L0 20.459h3.7442l1.3693-3.5527h7.0052l1.3693 3.5528h3.7442L10.5363 3.5409Zm-.3712 10.2232 2.2914-5.9456 2.2914 5.9456Z'

/** OpenAI's blossom mark, in a 24×24 box. */
// Codex mark (the Codex CLI product icon, not the OpenAI blossom). Single path, evenodd fill.
const CODEX_LOGO =
  'M8.086.457a6.105 6.105 0 013.046-.415c1.333.153 2.521.72 3.564 1.7a.117.117 0 00.107.029c1.408-.346 2.762-.224 4.061.366l.063.03.154.076c1.357.703 2.33 1.77 2.918 3.198.278.679.418 1.388.421 2.126a5.655 5.655 0 01-.18 1.631.167.167 0 00.04.155 5.982 5.982 0 011.578 2.891c.385 1.901-.01 3.615-1.183 5.14l-.182.22a6.063 6.063 0 01-2.934 1.851.162.162 0 00-.108.102c-.255.736-.511 1.364-.987 1.992-1.199 1.582-2.962 2.462-4.948 2.451-1.583-.008-2.986-.587-4.21-1.736a.145.145 0 00-.14-.032c-.518.167-1.04.191-1.604.185a5.924 5.924 0 01-2.595-.622 6.058 6.058 0 01-2.146-1.781c-.203-.269-.404-.522-.551-.821a7.74 7.74 0 01-.495-1.283 6.11 6.11 0 01-.017-3.064.166.166 0 00.008-.074.115.115 0 00-.037-.064 5.958 5.958 0 01-1.38-2.202 5.196 5.196 0 01-.333-1.589 6.915 6.915 0 01.188-2.132c.45-1.484 1.309-2.648 2.577-3.493.282-.188.55-.334.802-.438.286-.12.573-.22.861-.304a.129.129 0 00.087-.087A6.016 6.016 0 015.635 2.31C6.315 1.464 7.132.846 8.086.457zm-.804 7.85a.848.848 0 00-1.473.842l1.694 2.965-1.688 2.848a.849.849 0 001.46.864l1.94-3.272a.849.849 0 00.007-.854l-1.94-3.393zm5.446 6.24a.849.849 0 000 1.695h4.848a.849.849 0 000-1.696h-4.848z'

// Fallback body for a provider with no entry in PROVIDER_BODY. Neutral grey.
export const DEFAULT_BODY: PlanetBody = { base: '#52525b', glow: '#a1a1aa', mark: '?' }

// Body colour of a planet, by provider.
export const PROVIDER_BODY: Record<string, PlanetBody> = {
  claude: { base: token('claude', '#d97757'), glow: token('claude-glow', '#f2a486'), mark: 'C', logo: ANTHROPIC_LOGO },
  codex: { base: token('codex', '#e4e4e7'), glow: token('codex-glow', '#ffffff'), mark: 'X', logo: CODEX_LOGO, logoRule: 'evenodd' },
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
