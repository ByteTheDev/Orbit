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
}

/** Anthropic's mark (the "A"), in a 24×24 box. */
const ANTHROPIC_LOGO =
  'M17.3041 3.541h-3.6718l6.696 16.918H24Zm-10.6082 0L0 20.459h3.7442l1.3693-3.5527h7.0052l1.3693 3.5528h3.7442L10.5363 3.5409Zm-.3712 10.2232 2.2914-5.9456 2.2914 5.9456Z'

/** OpenAI's blossom mark, in a 24×24 box. */
const OPENAI_LOGO =
  'M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z'

// Fallback body for a provider with no entry in PROVIDER_BODY. Neutral grey.
export const DEFAULT_BODY: PlanetBody = { base: '#52525b', glow: '#a1a1aa', mark: '?' }

// Body colour of a planet, by provider.
export const PROVIDER_BODY: Record<string, PlanetBody> = {
  claude: { base: token('claude', '#d97757'), glow: token('claude-glow', '#f2a486'), mark: 'C', logo: ANTHROPIC_LOGO },
  codex: { base: token('codex', '#e4e4e7'), glow: token('codex-glow', '#ffffff'), mark: 'X', logo: OPENAI_LOGO },
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
